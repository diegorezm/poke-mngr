package pokeidle

import (
	"fmt"
	"sync"
	"time"

	"poke-mngr/internal/config"
)

var BallNames = map[int]string{
	1: "Poké Ball",
	2: "Great Ball",
	3: "Super Ball",
	4: "Ultra Ball",
	5: "Beast Ball",
}

var PotionNames = map[int]string{
	200:   "Small Potion",
	201:   "Great Potion",
	202:   "Ultra Potion",
	203:   "Hyper Potion",
	204:   "Ultimate Potion",
	70070: "Golden Potion",
}

// Default NPC fallback prices/heal values (overridden live by /assets/items.json when available).
type ShopItemMeta struct {
	ID      int
	Kind    string // "ball" | "item"
	Name    string
	Price   int64
	HealHP  int
	HealPct float64
	IsRevive bool
}

var DefaultNPCPotions = []ShopItemMeta{
	{ID: 200, Kind: "item", Name: "Small Potion", Price: 150, HealHP: 200},
	{ID: 201, Kind: "item", Name: "Great Potion", Price: 500, HealHP: 700},
	{ID: 202, Kind: "item", Name: "Ultra Potion", Price: 1500, HealHP: 2500},
	{ID: 203, Kind: "item", Name: "Hyper Potion", Price: 4000, HealHP: 8000},
	{ID: 204, Kind: "item", Name: "Ultimate Potion", Price: 10000, HealHP: 25000},
	{ID: 70070, Kind: "item", Name: "Golden Potion", Price: 25000, HealPct: 1.0},
}

var DefaultNPCBalls = map[int]int64{
	1: 50,
	2: 150,
	3: 400,
	4: 1000,
}

type SellResult struct {
	Label  string `json:"label"`
	Qty    int    `json:"qty"`
	Gained int64  `json:"gained"`
}

type ShopManager struct {
	mu           sync.Mutex
	awaiting     bool
	awaitKind    string
	awaitID      int
	awaitSince   time.Time
	pendingSell  chan SellResult
	lastTry      map[string]time.Time
	filling      map[string]bool // hysteresis state per category ("potion" | "revive" | "ball")
	consecFails  int
	pausedUntil  time.Time
	LastPurchase string
}

func NewShopManager() *ShopManager {
	return &ShopManager{
		lastTry: map[string]time.Time{},
		filling: map[string]bool{},
	}
}

func (sm *ShopManager) Reset() {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.awaiting = false
	if sm.pendingSell != nil {
		close(sm.pendingSell)
		sm.pendingSell = nil
	}
}

func (sm *ShopManager) HandleBattleEvent(ev map[string]any) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	switch asString(ev["k"]) {
	case "compra":
		sm.awaiting = false
		sm.consecFails = 0
		sm.LastPurchase = fmt.Sprintf("%s x%d (%d gold)", asString(ev["nome"]), asInt(ev["qtd"]), asInt64(ev["gasto"]))
	case "venda":
		if sm.pendingSell != nil {
			res := SellResult{
				Label:  asString(ev["nome"]),
				Qty:    asInt(ev["qtd"]),
				Gained: asInt64(ev["ganho"]),
			}
			select {
			case sm.pendingSell <- res:
			default:
			}
			close(sm.pendingSell)
			sm.pendingSell = nil
		}
	}
}

func (sm *ShopManager) HandleError(msg string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if !sm.awaiting {
		return
	}
	sm.awaiting = false
	sm.consecFails++
	if sm.consecFails >= 3 {
		sm.pausedUntil = time.Now().Add(2 * time.Minute)
		sm.consecFails = 0
	}
}

func (sm *ShopManager) AwaitingConfirmation() bool {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if sm.awaiting && time.Since(sm.awaitSince) > config.BuyConfirmTimeout {
		sm.awaiting = false
	}
	return sm.awaiting
}

func (sm *ShopManager) BeginBuy(kind string, id int) bool {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if sm.awaiting && time.Since(sm.awaitSince) <= config.BuyConfirmTimeout {
		return false
	}
	sm.awaiting = true
	sm.awaitKind = kind
	sm.awaitID = id
	sm.awaitSince = time.Now()
	return true
}

func (sm *ShopManager) BeginSell() (<-chan SellResult, error) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if sm.pendingSell != nil {
		return nil, fmt.Errorf("já há uma venda em andamento para esta conta")
	}
	ch := make(chan SellResult, 1)
	sm.pendingSell = ch
	return ch, nil
}

type RestockOrder struct {
	Kind string
	ID   int
	Qty  int
}

// EvaluateRestock checks Potion -> Revive -> Ball using both manager-online & pokeidleDeck rules:
// gold floor, hysteresis (below -> keep), best HP/gold potion, and max 9999 per order.
func (sm *ShopManager) EvaluateRestock(opts config.AccountOptions, estado map[string]any, activePk map[string]any, catalog *ItemCatalog) *RestockOrder {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	now := time.Now()
	if now.Before(sm.pausedUntil) {
		return nil
	}
	if sm.awaiting && now.Sub(sm.awaitSince) <= config.BuyConfirmTimeout {
		return nil
	}
	sm.awaiting = false

	gold := asInt64(estado["gold"])
	rc := opts.Restock
	if !rc.Enabled && !opts.AutoPotion && !opts.AutoBallRestock {
		return nil
	}
	if rc.GoldFloor > 0 && gold <= rc.GoldFloor {
		return nil
	}
	availGold := gold - rc.GoldFloor
	if availGold < 0 {
		availGold = 0
	}

	// 1. Potions
	if rc.Enabled && rc.Potion.Enabled || (!rc.Enabled && opts.AutoPotion) {
		below := rc.Potion.Below
		keep := rc.Potion.Keep
		targetID := rc.Potion.ID
		if !rc.Enabled {
			below = opts.PotionRestockThreshold
			keep = below + opts.PotionRestockQty
			if opts.PotionID != nil {
				targetID = *opts.PotionID
			}
		}
		if targetID == 0 {
			targetID = resolveEquippedPotionID(estado, activePk, opts.PotionID, catalog)
		}
		if targetID > 0 {
			stock := mapIntValue(asMap(estado["items"]), targetID)
			if order := sm.planOrder("potion", "item", targetID, stock, below, keep, availGold, catalog.UnitPrice("item", targetID), now); order != nil {
				return order
			}
		}
	}

	// 2. Revives (pokeidleDeck feature)
	if rc.Enabled && rc.Revive.Enabled && catalog != nil {
		if reviveID, revivePrice := catalog.CheapestRevive(); reviveID > 0 {
			totalRevives := catalog.TotalRevives(asMap(estado["items"]))
			if order := sm.planOrder("revive", "item", reviveID, totalRevives, rc.Revive.Below, rc.Revive.Keep, availGold, revivePrice, now); order != nil {
				return order
			}
		}
	}

	// 3. Pokéballs
	if rc.Enabled && rc.Ball.Enabled || (!rc.Enabled && opts.AutoBallRestock) {
		below := rc.Ball.Below
		keep := rc.Ball.Keep
		targetID := rc.Ball.ID
		if !rc.Enabled {
			below = opts.BallRestockThreshold
			keep = below + opts.BallRestockQty
			if opts.BallID != nil {
				targetID = *opts.BallID
			}
		}
		if targetID == 0 {
			targetID = resolveEquippedBallID(estado, opts.BallPriority, opts.BallID)
		}
		if targetID > 0 && config.BuyableBallIDs[targetID] {
			stock := mapIntValue(asMap(estado["balls"]), targetID)
			if order := sm.planOrder("ball", "ball", targetID, stock, below, keep, availGold, catalog.UnitPrice("ball", targetID), now); order != nil {
				return order
			}
		}
	}

	return nil
}

func (sm *ShopManager) planOrder(cat, kind string, id, stock, below, keep int, availGold, unitPrice int64, now time.Time) *RestockOrder {
	if below <= 0 {
		below = 10
	}
	if keep <= below {
		keep = below + 100
	}
	if stock < below {
		sm.filling[cat] = true
	} else if stock >= keep {
		sm.filling[cat] = false
		return nil
	}
	if !sm.filling[cat] {
		return nil
	}

	tryKey := fmt.Sprintf("%s:%d", kind, id)
	if last, ok := sm.lastTry[tryKey]; ok && now.Sub(last) < config.RestockRetryGap {
		return nil
	}

	need := keep - stock
	if need <= 0 {
		sm.filling[cat] = false
		return nil
	}
	if need > 9999 {
		need = 9999
	}
	if unitPrice > 0 && availGold > 0 {
		maxAfford := int(availGold / unitPrice)
		if maxAfford <= 0 {
			return nil
		}
		if need > maxAfford {
			need = maxAfford
		}
	}
	sm.lastTry[tryKey] = now
	sm.awaiting = true
	sm.awaitKind = kind
	sm.awaitID = id
	sm.awaitSince = now
	return &RestockOrder{Kind: kind, ID: id, Qty: need}
}

func resolveEquippedPotionID(estado map[string]any, activePk map[string]any, fixed *int, catalog *ItemCatalog) int {
	if fixed != nil && *fixed > 0 {
		return *fixed
	}
	if activePk != nil {
		held := asInt(activePk["heldItemId"])
		if config.KnownPotionIDs[held] {
			return held
		}
	}
	auto := asMap(estado["automation"])
	if auto != nil {
		for _, pid := range asIntSlice(auto["potionIds"]) {
			if config.KnownPotionIDs[pid] {
				return pid
			}
		}
	}
	if catalog != nil && activePk != nil {
		if best := catalog.BestCostPotion(asInt(activePk["maxHp"]), asFloat(auto["hpLimiar"])); best > 0 {
			return best
		}
	}
	return 0
}

func resolveEquippedBallID(estado map[string]any, priority []int, fixed *int) int {
	if fixed != nil && *fixed > 0 {
		return *fixed
	}
	auto := asMap(estado["automation"])
	if auto != nil {
		for _, bid := range asIntSlice(auto["ballIds"]) {
			if config.BuyableBallIDs[bid] {
				return bid
			}
		}
	}
	for _, bid := range priority {
		if config.BuyableBallIDs[bid] {
			return bid
		}
	}
	return 0
}
