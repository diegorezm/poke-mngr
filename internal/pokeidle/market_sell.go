package pokeidle

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"time"

	"poke-mngr/internal/config"
	"poke-mngr/internal/store"
)

const (
	autoSellTickInterval     = 45 * time.Second
	autoSellMaxActionsPerAcc = 5
	defaultTaxaDiaria        = 100_000
	defaultMaxAdsPokemon     = 10
	defaultEsperaEditarMin   = 30
	defaultMinGoldPrice      = 2
	defaultMinOrbPrice       = 2
)

type MarketLimits struct {
	TaxaDiaria         int64
	MaxAnunciosPokemon int
	EsperaEditarMin    int
	PrecoMinGold       int64
	PrecoMinOrb        int64
}

func ParseMarketLimits(cfg map[string]any) MarketLimits {
	lim := MarketLimits{
		TaxaDiaria:         defaultTaxaDiaria,
		MaxAnunciosPokemon: defaultMaxAdsPokemon,
		EsperaEditarMin:    defaultEsperaEditarMin,
		PrecoMinGold:       defaultMinGoldPrice,
		PrecoMinOrb:        defaultMinOrbPrice,
	}
	if cfg == nil {
		return lim
	}
	if v := asInt64(cfg["taxaDiaria"]); v > 0 {
		lim.TaxaDiaria = v
	}
	if v := asInt(cfg["maxAnunciosPokemon"]); v > 0 {
		lim.MaxAnunciosPokemon = v
	}
	if v := asInt(cfg["esperaEditarItemMin"]); v > 0 {
		lim.EsperaEditarMin = v
	}
	if v := asInt64(cfg["precoMinGold"]); v >= 2 {
		lim.PrecoMinGold = v
	}
	if v := asInt64(cfg["precoMinOrb"]); v >= 2 {
		lim.PrecoMinOrb = v
	}
	return lim
}

func (l MarketLimits) MinPriceFor(moeda string) int64 {
	if moeda == "orb" {
		if l.PrecoMinOrb >= 2 {
			return l.PrecoMinOrb
		}
		return defaultMinOrbPrice
	}
	if l.PrecoMinGold >= 2 {
		return l.PrecoMinGold
	}
	return defaultMinGoldPrice
}

// NetMarketProceeds mirrors PokéIdle's shared/taxa-mercado.mjs commission rules.
// Items & gold sales have a flat 15% fee; Pokémon sold for Orbs use tiered brackets (13% / 10% / 7.5%).
func NetMarketProceeds(unitPrice int64, qty int, moeda, target string) int64 {
	if unitPrice <= 0 || qty <= 0 {
		return 0
	}
	total := unitPrice * int64(qty)
	if moeda != "orb" {
		return int64(math.Floor(float64(total) * 0.85))
	}
	if target != "pokemon" {
		fee := int64(math.Ceil(float64(total*1500) / 10000.0))
		if fee > total {
			fee = total
		}
		return total - fee
	}
	// Progressive orb brackets for Pokémon: <=500: 13%, <=5000: 10%, >5000: 7.5%
	type bracket struct {
		upTo int64
		bp   int64
	}
	brackets := []bracket{
		{500, 1300},
		{5000, 1000},
		{math.MaxInt64, 750},
	}
	var floor int64
	var bpSum int64
	for _, b := range brackets {
		capVal := total
		if capVal > b.upTo {
			capVal = b.upTo
		}
		if capVal <= floor {
			break
		}
		bpSum += (capVal - floor) * b.bp
		floor = capVal
	}
	fee := int64(math.Ceil(float64(bpSum) / 10000.0))
	if fee > total {
		fee = total
	}
	return total - fee
}

// ExtractValidFloor scans live competitor listings, ignoring own accounts, non-open ads,
// and obvious spoof/bait listings (<50% of 7d avg when avg is known).
func ExtractValidFloor(listings []any, ownNicks map[string]bool, refAvg float64) (int64, int) {
	var best int64
	validCount := 0
	spoofCutoff := int64(0)
	if refAvg > 0 {
		spoofCutoff = int64(math.Floor(refAvg * 0.50))
	}

	for _, raw := range listings {
		ad := asMap(raw)
		if ad == nil {
			continue
		}
		st := asString(ad["estado"])
		if st != "" && st != "aberto" {
			continue
		}
		if asString(ad["comprador"]) != "" {
			continue
		}
		seller := strings.ToLower(strings.TrimSpace(asString(ad["vendedor"])))
		if seller != "" && ownNicks[seller] {
			continue
		}
		price := asInt64(ad["preco"])
		if price <= 0 {
			continue
		}
		if spoofCutoff > 0 && price < spoofCutoff {
			continue
		}
		validCount++
		if best == 0 || price < best {
			best = price
		}
	}
	return best, validCount
}

type SellPriceDecision struct {
	Price       int64   `json:"price"`
	ShouldList  bool    `json:"shouldList"`
	Reason      string  `json:"reason"`
	MarketFloor int64   `json:"marketFloor"`
	RefAvg      float64 `json:"refAvg"`
	HardFloor   int64   `json:"hardFloor"`
}

func applyUndercut(marketFloor int64, step int64, pct float64) int64 {
	if marketFloor <= 1 {
		return marketFloor
	}
	delta := step
	if pct > 0 {
		pctDelta := int64(math.Round(float64(marketFloor) * (pct / 100.0)))
		if pctDelta > delta {
			delta = pctDelta
		}
	}
	if delta <= 0 {
		delta = 1
	}
	out := marketFloor - delta
	if out < 1 {
		out = 1
	}
	return out
}

// ComputeSellPrice determines the listing unit price for "smart", "undercut", or "fixed" pricing modes.
func ComputeSellPrice(spec store.MarketSellRuleSpec, marketFloor int64, refAvg float64, minAllowed int64) SellPriceDecision {
	if minAllowed < 2 {
		minAllowed = 2
	}
	mode := strings.ToLower(strings.TrimSpace(spec.PriceMode))
	if mode == "" {
		mode = "smart"
	}
	belowAction := strings.ToLower(strings.TrimSpace(spec.BelowFloorAction))
	if belowAction == "" {
		belowAction = "hold"
	}

	hardFloor := minAllowed
	if spec.MinPrice > hardFloor {
		hardFloor = spec.MinPrice
	}
	if mode == "smart" && refAvg > 0 && spec.MinPctOfAvg > 0 {
		avgFloor := int64(math.Ceil(refAvg * (spec.MinPctOfAvg / 100.0)))
		if avgFloor > hardFloor {
			hardFloor = avgFloor
		}
	}

	dec := SellPriceDecision{
		MarketFloor: marketFloor,
		RefAvg:      refAvg,
		HardFloor:   hardFloor,
	}

	switch mode {
	case "fixed":
		if spec.FixedPrice < minAllowed {
			dec.Reason = fmt.Sprintf("preço fixo inválido (mínimo %d)", minAllowed)
			return dec
		}
		dec.Price = spec.FixedPrice
		dec.ShouldList = true
		dec.Reason = "preço fixo"
		return dec

	case "undercut":
		if marketFloor <= 0 {
			if spec.MinPrice >= minAllowed && belowAction == "list_at_floor" {
				dec.Price = spec.MinPrice
				dec.ShouldList = true
				dec.Reason = "sem concorrentes — usando piso mínimo"
				return dec
			}
			dec.Reason = "sem anúncios concorrentes para undercut"
			return dec
		}
		cand := applyUndercut(marketFloor, spec.UndercutStep, spec.UndercutPct)
		if spec.MinPrice > 0 && cand < spec.MinPrice {
			if belowAction == "list_at_floor" {
				dec.Price = spec.MinPrice
				dec.ShouldList = true
				dec.Reason = "undercut travado no piso mínimo"
				return dec
			}
			dec.Reason = fmt.Sprintf("mercado (%d) abaixo do piso (%d) — segurando", marketFloor, spec.MinPrice)
			return dec
		}
		if cand < minAllowed {
			cand = minAllowed
		}
		dec.Price = cand
		dec.ShouldList = true
		dec.Reason = fmt.Sprintf("undercut do piso (%d)", marketFloor)
		return dec

	default: // "smart"
		if marketFloor > 0 {
			cand := applyUndercut(marketFloor, spec.UndercutStep, spec.UndercutPct)
			if cand < hardFloor {
				if belowAction == "list_at_floor" {
					dec.Price = hardFloor
					dec.ShouldList = true
					dec.Reason = fmt.Sprintf("mercado (%d) abaixo do piso smart (%d) — anunciando no piso", marketFloor, hardFloor)
					return dec
				}
				dec.Reason = fmt.Sprintf("mercado (%d) abaixo do piso smart (%d) — segurando", marketFloor, hardFloor)
				return dec
			}
			dec.Price = cand
			dec.ShouldList = true
			dec.Reason = fmt.Sprintf("smart: batendo piso válido (%d)", marketFloor)
			return dec
		}
		// No live competitor listings: fall back to historical avg/median or explicit floor
		if refAvg > 0 {
			p := int64(math.Round(refAvg))
			if p < hardFloor {
				p = hardFloor
			}
			dec.Price = p
			dec.ShouldList = true
			dec.Reason = "smart: sem concorrentes — usando média/mediana"
			return dec
		}
		if spec.MinPrice >= minAllowed {
			dec.Price = spec.MinPrice
			dec.ShouldList = true
			dec.Reason = "smart: sem histórico — usando piso fixo"
			return dec
		}
		dec.Reason = "sem referência de preço ou piso configurado"
		return dec
	}
}

// IsItemInMarketCatalog checks whether the server's welcome `mercado.catalogo` allows listing itemID.
// Returns true if the server didn't send a catalog yet (permissive fallback).
func IsItemInMarketCatalog(mercadoCfg map[string]any, itemID int) bool {
	if mercadoCfg == nil {
		return true
	}
	cat := asSlice(mercadoCfg["catalogo"])
	if len(cat) == 0 {
		return true
	}
	for _, raw := range cat {
		if m := asMap(raw); m != nil && asInt(m["id"]) == itemID {
			return true
		}
	}
	return false
}

// ComputeSellableItemExcess returns how many free (non-bound) units can be listed while
// keeping at least keepQty total units in the bag (bound units count toward keepQty).
func ComputeSellableItemExcess(total, bound, keepQty int) (excess int, free int) {
	if total <= 0 {
		return 0, 0
	}
	if bound < 0 {
		bound = 0
	}
	if bound > total {
		bound = total
	}
	free = total - bound
	if keepQty < 0 {
		keepQty = 0
	}
	overKeep := total - keepQty
	if overKeep <= 0 {
		return 0, free
	}
	if overKeep > free {
		return free, free
	}
	return overKeep, free
}

// HasRestockConflict prevents infinite buy-from-NPC -> auto-sell-on-market loops.
func HasRestockConflict(opts config.AccountOptions, itemID int, keepQty int, catalog *ItemCatalog) (bool, string) {
	rc := opts.Restock
	if rc.Enabled {
		if rc.Potion.Enabled {
			if rc.Potion.ID == itemID || (rc.Potion.ID == 0 && config.KnownPotionIDs[itemID]) {
				if keepQty <= rc.Potion.Keep {
					return true, fmt.Sprintf("conflito com Restock de Poção (Keep=%d)", rc.Potion.Keep)
				}
			}
		}
		if rc.Revive.Enabled && catalog != nil {
			if revID, _ := catalog.CheapestRevive(); revID > 0 && revID == itemID {
				if keepQty <= rc.Revive.Keep {
					return true, fmt.Sprintf("conflito com Restock de Revive (Keep=%d)", rc.Revive.Keep)
				}
			}
		}
	} else if opts.AutoPotion {
		if (opts.PotionID != nil && *opts.PotionID == itemID) || (opts.PotionID == nil && config.KnownPotionIDs[itemID]) {
			legacyKeep := opts.PotionRestockThreshold + opts.PotionRestockQty
			if keepQty <= legacyKeep {
				return true, fmt.Sprintf("conflito com Auto-Poção (Keep=%d)", legacyKeep)
			}
		}
	}
	return false, ""
}

func isPokemonProtected(pk PokemonDetail, raw map[string]any) (bool, string) {
	if pk.Active {
		return true, "ativo"
	}
	if pk.InTeam {
		return true, "no time"
	}
	if pk.Locked {
		return true, "trancado"
	}
	if pk.HeldItemID > 0 {
		return true, "item equipado"
	}
	if raw != nil {
		if asString(raw["skin"]) != "" || asInt(raw["skinId"]) > 0 || asString(raw["skinEquipada"]) != "" {
			return true, "com skin"
		}
		if asInt(raw["casaId"]) > 0 || asBool(raw["emCasa"]) {
			return true, "na casa"
		}
	}
	return false, ""
}

func isPokemonMarketEligible(pk PokemonDetail) bool {
	if pk.Shiny || pk.Potency >= 5 {
		return true
	}
	return pk.Level >= 50 && pk.Grade >= 3.5-1e-9
}

func pokemonMatchesSellSpec(pk PokemonDetail, spec store.MarketSellRuleSpec) bool {
	q := strings.ToLower(strings.TrimSpace(spec.Query))
	if q != "" {
		nm := strings.ToLower(pk.Name)
		sp := strings.ToLower(pk.Species)
		if !strings.Contains(nm, q) && !strings.Contains(sp, q) {
			return false
		}
	}
	shinyMode := strings.ToLower(strings.TrimSpace(spec.ShinyMode))
	if shinyMode == "" {
		shinyMode = "no"
	}
	switch shinyMode {
	case "no":
		if pk.Shiny {
			return false
		}
	case "only":
		if !pk.Shiny {
			return false
		}
	case "any":
		// Server forbids listing Shiny Pokémon in Gold.
		if pk.Shiny && spec.Moeda != "orb" {
			return false
		}
	}
	if pk.Potency >= 5 && !spec.AllowP5 {
		return false
	}
	if pk.TmElemental != "" && !spec.AllowZMove {
		return false
	}
	if pk.TmAoe && !spec.AllowTmAoe {
		return false
	}
	if spec.MaxGrade > 0 && pk.Grade > spec.MaxGrade {
		return false
	}
	if spec.MaxIV > 0 && pk.IVSum > spec.MaxIV {
		return false
	}
	if spec.MinLevel > 0 && pk.Level < spec.MinLevel {
		return false
	}
	if spec.MaxLevel > 0 && pk.Level > spec.MaxLevel {
		return false
	}
	return true
}

// SelectExcessPokemons groups all account Pokémon by species, preserves the top KeepBestCount
// per species (by Grade -> IVSum -> Level, counting team/locked Pokémon among the kept ones),
// and returns the remaining Pokémon that pass all safety blocks, server eligibility, and rule filters.
func SelectExcessPokemons(allPks []PokemonDetail, rawByID map[int]map[string]any, spec store.MarketSellRuleSpec) []PokemonDetail {
	keepN := spec.KeepBestCount
	if keepN < 0 {
		keepN = 0
	}

	bySpecies := map[string][]PokemonDetail{}
	for _, pk := range allPks {
		key := strings.ToLower(strings.TrimSpace(pk.Name))
		if key == "" {
			key = fmt.Sprintf("id:%d", pk.PokeID)
		}
		bySpecies[key] = append(bySpecies[key], pk)
	}

	var candidates []PokemonDetail
	for _, group := range bySpecies {
		// Sort best first: Shiny -> P5 -> Grade -> IVSum -> Level
		sort.Slice(group, func(i, j int) bool {
			if group[i].Shiny != group[j].Shiny {
				return group[i].Shiny
			}
			if group[i].Potency != group[j].Potency {
				return group[i].Potency > group[j].Potency
			}
			if group[i].Grade != group[j].Grade {
				return group[i].Grade > group[j].Grade
			}
			if group[i].IVSum != group[j].IVSum {
				return group[i].IVSum > group[j].IVSum
			}
			if group[i].Level != group[j].Level {
				return group[i].Level > group[j].Level
			}
			return group[i].ID < group[j].ID
		})

		for idx, pk := range group {
			if idx < keepN {
				continue
			}
			if protected, _ := isPokemonProtected(pk, rawByID[pk.ID]); protected {
				continue
			}
			if !isPokemonMarketEligible(pk) {
				continue
			}
			if !pokemonMatchesSellSpec(pk, spec) {
				continue
			}
			candidates = append(candidates, pk)
		}
	}

	// List weakest/cheapest-priority candidates first for determinism
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Grade != candidates[j].Grade {
			return candidates[i].Grade < candidates[j].Grade
		}
		if candidates[i].IVSum != candidates[j].IVSum {
			return candidates[i].IVSum < candidates[j].IVSum
		}
		return candidates[i].ID < candidates[j].ID
	})
	return candidates
}

// ShouldRepriceListing decides whether an open listing should be edited to targetPrice,
// respecting server retention (compravelEm), edit cooldown (editavelEm), and minDiffPct threshold.
func ShouldRepriceListing(listing map[string]any, targetPrice int64, minDiffPct float64, nowMs int64) (bool, string) {
	if listing == nil || targetPrice < 2 {
		return false, "alvo inválido"
	}
	st := asString(listing["estado"])
	if st != "" && st != "aberto" {
		return false, "anúncio não está aberto"
	}
	if buyableAt := asInt64(listing["compravelEm"]); buyableAt > nowMs {
		remSec := (buyableAt - nowMs + 999) / 1000
		return false, fmt.Sprintf("em retenção (%ds)", remSec)
	}
	if editableAt := asInt64(listing["editavelEm"]); editableAt > nowMs {
		remMin := (editableAt - nowMs + 59_999) / 60_000
		return false, fmt.Sprintf("cooldown de edição (%d min)", remMin)
	}
	curPrice := asInt64(listing["preco"])
	if curPrice <= 0 {
		return false, "preço atual inválido"
	}
	if curPrice == targetPrice {
		return false, "já está no preço ideal"
	}
	if minDiffPct <= 0 {
		minDiffPct = 3.0
	}
	diffPct := math.Abs(float64(targetPrice-curPrice)) / float64(curPrice) * 100.0
	if diffPct < minDiffPct {
		return false, fmt.Sprintf("diferença %.1f%% < mínimo %.1f%%", diffPct, minDiffPct)
	}
	return true, fmt.Sprintf("reajustar %d → %d (%+.1f%%)", curPrice, targetPrice, float64(targetPrice-curPrice)/float64(curPrice)*100.0)
}

type AutoSellPreviewItem struct {
	RuleID      int     `json:"ruleId"`
	AccountID   int     `json:"accountId"`
	AccountNick string  `json:"accountNick"`
	Action      string  `json:"action"` // "create" | "reprice" | "hold" | "blocked"
	Target      string  `json:"target"` // "item" | "pokemon"
	Label       string  `json:"label"`
	ListingID   int     `json:"listingId,omitempty"`
	Qty         int     `json:"qty"`
	CurrentPrice int64  `json:"currentPrice,omitempty"`
	Price       int64   `json:"price"`
	Moeda       string  `json:"moeda"`
	MarketFloor int64   `json:"marketFloor"`
	RefAvg      float64 `json:"refAvg"`
	HardFloor   int64   `json:"hardFloor"`
	Reason      string  `json:"reason"`
}

func (ms *MarketService) lookupPokemonMedian(ctx context.Context, conn *AccountConnection, speciesName, moeda string, shiny bool) (float64, bool) {
	key := fmt.Sprintf("%s:%s:%v", strings.ToLower(strings.TrimSpace(speciesName)), moeda, shiny)
	if strings.TrimSpace(speciesName) == "" {
		return 0, false
	}
	ms.cacheMu.Lock()
	if hit, ok := ms.pokeMedianCache[key]; ok && time.Now().Before(hit.exp) {
		ms.cacheMu.Unlock()
		return hit.gems, hit.ok
	}
	ms.cacheMu.Unlock()

	if conn == nil {
		return 0, false
	}
	filters := map[string]any{
		"tipo":  "pokemon",
		"moeda": moeda,
		"busca": speciesName,
	}
	if shiny {
		filters["soShiny"] = 1
	}
	res, err := conn.market.QueryTapeFiltered(ctx, "global", 0, filters)
	if err != nil {
		return 0, false
	}
	var prices []float64
	for _, raw := range asSlice(res["linhas"]) {
		r := asMap(raw)
		if r == nil {
			continue
		}
		if m := asString(r["moeda"]); m != "" && m != moeda {
			continue
		}
		if shiny && !asBool(r["shiny"]) {
			ficha := asMap(r["ficha"])
			if ficha == nil || !asBool(ficha["shiny"]) {
				continue
			}
		}
		p := asFloat(r["bruto"])
		if p <= 0 {
			p = asFloat(r["preco"])
		}
		if p > 0 {
			prices = append(prices, p)
		}
	}
	var median float64
	ok := false
	if len(prices) >= 2 {
		sort.Float64s(prices)
		median = prices[len(prices)/2]
		ok = true
	}
	ms.cacheMu.Lock()
	ms.pokeMedianCache[key] = shinyPriceCacheEntry{gems: median, ok: ok, exp: time.Now().Add(30 * time.Minute)}
	ms.cacheMu.Unlock()
	return median, ok
}

func (ms *MarketService) tickAutoSell(ctx context.Context) {
	gs := ms.mgr.Settings()
	if !gs.AutoSellEnabled {
		return
	}
	ms.cacheMu.Lock()
	if !ms.lastAutoSellTick.IsZero() && time.Since(ms.lastAutoSellTick) < autoSellTickInterval {
		ms.cacheMu.Unlock()
		return
	}
	ms.lastAutoSellTick = time.Now()
	ms.cacheMu.Unlock()

	_, _ = ms.RunAutoSell(ctx, gs.AutoSellDryRun, 0)
}

// PreviewAutoSell simulates all enabled sell rules (or a specific ruleID even if paused) without sending WS mutations.
func (ms *MarketService) PreviewAutoSell(ctx context.Context, ruleID int) ([]AutoSellPreviewItem, error) {
	return ms.RunAutoSell(ctx, true, ruleID)
}

// CancelListing manually cancels a listing for an account and logs the outcome.
func (ms *MarketService) CancelListing(ctx context.Context, accID, listingID int) (MarketActionResult, error) {
	conn := ms.pickOnlineConn(accID)
	if conn == nil {
		return MarketActionResult{Status: "recusado", Detail: "conta offline"}, errors.New("conta offline")
	}
	res, err := conn.market.CancelListing(ctx, listingID)
	_ = ms.store.AppendMarketLog(conn.Account().ID, 0, "cancelar_"+res.Status, fmt.Sprintf("[%s] Cancelar anúncio #%d: %s", conn.Account().Nick, listingID, res.Detail))
	return res, err
}

// EditListing manually edits a listing's price/currency and logs the outcome.
func (ms *MarketService) EditListing(ctx context.Context, accID, listingID int, price int64, moeda string) (MarketActionResult, error) {
	conn := ms.pickOnlineConn(accID)
	if conn == nil {
		return MarketActionResult{Status: "recusado", Detail: "conta offline"}, errors.New("conta offline")
	}
	res, err := conn.market.EditListing(ctx, listingID, price, moeda)
	_ = ms.store.AppendMarketLog(conn.Account().ID, 0, "editar_"+res.Status, fmt.Sprintf("[%s] Editar anúncio #%d → %d %s: %s", conn.Account().Nick, listingID, price, moeda, res.Detail))
	return res, err
}

// RunAutoSell evaluates excess items, excess Pokémon, and open listings for reprice across eligible accounts.
func (ms *MarketService) RunAutoSell(ctx context.Context, dryRun bool, onlyRuleID int) ([]AutoSellPreviewItem, error) {
	rules, err := ms.store.ListMarketSellRules()
	if err != nil {
		return nil, err
	}
	var active []store.MarketSellRule
	for _, r := range rules {
		if onlyRuleID > 0 {
			if r.ID == onlyRuleID {
				active = append(active, r)
			}
			continue
		}
		if r.Enabled {
			active = append(active, r)
		}
	}
	if len(active) == 0 {
		return []AutoSellPreviewItem{}, nil
	}

	// Gather online connections without holding mgr.mu across any I/O.
	ms.mgr.mu.RLock()
	conns := make([]*AccountConnection, 0, len(ms.mgr.conns))
	ownNicks := make(map[string]bool, len(ms.mgr.conns))
	for _, c := range ms.mgr.conns {
		acc := c.Account()
		ownNicks[strings.ToLower(strings.TrimSpace(acc.Nick))] = true
		if c.IsOnline() {
			conns = append(conns, c)
		}
	}
	ms.mgr.mu.RUnlock()

	if len(conns) == 0 {
		if onlyRuleID > 0 || dryRun {
			return nil, errors.New("nenhuma conta online para avaliar auto-venda")
		}
		return []AutoSellPreviewItem{}, nil
	}

	sort.Slice(conns, func(i, j int) bool { return conns[i].Account().OrderIndex < conns[j].Account().OrderIndex })

	ms.mgr.catalog.EnsureLoaded(ctx)
	ms.mgr.creatures.EnsureLoaded(ctx)
	_, _ = ms.refreshMedias(ctx, conns[0], 5*time.Minute)

	// Per-cycle caches to minimize WS queries.
	myListingsByAcc := map[int][]map[string]any{}
	itemFloorCache := map[string]int64{} // "itemId:moeda" -> valid floor
	pokeFloorCache := map[string]int64{} // comparable key -> valid floor
	actionsByAcc := map[int]int{}

	getMyListings := func(c *AccountConnection) []map[string]any {
		id := c.Account().ID
		if cached, ok := myListingsByAcc[id]; ok {
			return cached
		}
		res, qErr := c.market.QueryMyListings(ctx)
		if qErr != nil {
			myListingsByAcc[id] = nil
			return nil
		}
		var out []map[string]any
		for _, raw := range asSlice(res["linhas"]) {
			if m := asMap(raw); m != nil {
				out = append(out, m)
			}
		}
		myListingsByAcc[id] = out
		return out
	}

	getItemFloor := func(c *AccountConnection, itemID int, moeda string, avg float64) int64 {
		key := fmt.Sprintf("%d:%s", itemID, moeda)
		if v, ok := itemFloorCache[key]; ok {
			return v
		}
		res, qErr := c.market.QueryItemListings(ctx, itemID, moeda)
		if qErr != nil {
			return 0
		}
		fl, _ := ExtractValidFloor(asSlice(res["linhas"]), ownNicks, avg)
		itemFloorCache[key] = fl
		return fl
	}

	getPokemonFloor := func(c *AccountConnection, pk PokemonDetail, moeda string, refMedian float64) int64 {
		ivBucket := 0
		if pk.IVSum >= 140 {
			ivBucket = ((pk.IVSum - 15) / 10) * 10
		}
		key := fmt.Sprintf("%s:%s:%v:%v:%v:%v:%d",
			strings.ToLower(pk.Name), moeda, pk.Shiny, pk.Potency >= 5, pk.TmElemental != "", pk.TmAoe, ivBucket)
		if v, ok := pokeFloorCache[key]; ok {
			return v
		}
		filters := map[string]any{
			"tipo":          "pokemon",
			"moeda":         moeda,
			"ordem":         "baratos",
			"busca":         pk.Name,
			"soShiny":       pk.Shiny,
			"soP5":          pk.Potency >= 5,
			"soTmElemental": pk.TmElemental != "",
			"soTmAoe":       pk.TmAoe,
			"pagina":        0,
		}
		if ivBucket > 0 {
			filters["ivMin"] = ivBucket
		}
		res, qErr := c.market.QueryVitrine(ctx, filters)
		if qErr != nil {
			return 0
		}
		fl, _ := ExtractValidFloor(asSlice(res["linhas"]), ownNicks, refMedian)
		pokeFloorCache[key] = fl
		return fl
	}

	var previews []AutoSellPreviewItem
	repricedListingIDs := map[int]bool{}

	for _, rule := range active {
		spec := rule.Spec
		moeda := spec.Moeda
		if moeda != "orb" {
			moeda = "gold"
		}
		if spec.Target == "pokemon" && strings.ToLower(spec.ShinyMode) == "only" {
			moeda = "orb"
		}
		spec.Moeda = moeda

		accFilter := map[int]bool{}
		for _, id := range spec.AccountIDs {
			accFilter[id] = true
		}

		for _, c := range conns {
			snap := c.SellStateSnapshot()
			if !snap.Online {
				continue
			}
			acc := snap.Account
			if len(accFilter) > 0 && !accFilter[acc.ID] {
				continue
			}
			if !dryRun && actionsByAcc[acc.ID] >= autoSellMaxActionsPerAcc {
				continue
			}

			limits := ParseMarketLimits(snap.MercadoCfg)
			minAllowed := limits.MinPriceFor(moeda)
			myAds := getMyListings(c)
			nowMs := c.market.ServerNowMs()

			if spec.Target == "item" {
				if spec.ItemID <= 0 {
					continue
				}
				itemLabel := spec.ItemName
				if dm, ok := ms.mgr.catalog.Display(spec.ItemID); ok {
					if itemLabel == "" {
						itemLabel = dm.Name
					}
				}
				if itemLabel == "" {
					itemLabel = fmt.Sprintf("Item #%d", spec.ItemID)
				}
				if !IsItemInMarketCatalog(snap.MercadoCfg, spec.ItemID) {
					previews = append(previews, AutoSellPreviewItem{
						RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
						Action: "blocked", Target: "item", Label: itemLabel, Moeda: moeda,
						Reason: "item não aceito no catálogo do mercado do servidor",
					})
					continue
				}

				if conflict, reason := HasRestockConflict(acc.Options, spec.ItemID, spec.KeepQty, ms.mgr.catalog); conflict {
					previews = append(previews, AutoSellPreviewItem{
						RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
						Action: "blocked", Target: "item", Label: itemLabel, Moeda: moeda,
						Reason: reason,
					})
					continue
				}

				avg, _ := ms.avgInfo(spec.ItemID, moeda)
				marketFloor := getItemFloor(c, spec.ItemID, moeda, avg)
				dec := ComputeSellPrice(spec, marketFloor, avg, minAllowed)

				// 1. Check open listings of this item for auto-reprice
				activeItemAds := 0
				for _, ad := range myAds {
					if asString(ad["tipo"]) == "pokemon" || asInt(ad["itemId"]) != spec.ItemID {
						continue
					}
					adMoeda := asString(ad["moeda"])
					if adMoeda == "" {
						adMoeda = "gold"
					}
					if adMoeda != moeda {
						continue
					}
					st := asString(ad["estado"])
					if st != "" && st != "aberto" {
						continue
					}
					activeItemAds++

					adID := asInt(ad["id"])
					if !spec.RepriceEnabled || repricedListingIDs[adID] || !dec.ShouldList {
						continue
					}
					okReprice, rReason := ShouldRepriceListing(ad, dec.Price, spec.RepriceMinDiffPct, nowMs)
					if !okReprice {
						continue
					}
					repricedListingIDs[adID] = true
					curPrice := asInt64(ad["preco"])
					adQty := asInt(ad["qtd"])
					if adQty <= 0 {
						adQty = 1
					}
					itemPrev := AutoSellPreviewItem{
						RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
						Action: "reprice", Target: "item", Label: itemLabel,
						ListingID: adID, Qty: adQty, CurrentPrice: curPrice, Price: dec.Price, Moeda: moeda,
						MarketFloor: dec.MarketFloor, RefAvg: dec.RefAvg, HardFloor: dec.HardFloor,
						Reason: rReason,
					}
					previews = append(previews, itemPrev)
					if !dryRun && actionsByAcc[acc.ID] < autoSellMaxActionsPerAcc {
						res, eErr := c.market.EditListing(ctx, adID, dec.Price, moeda)
						actionsByAcc[acc.ID]++
						msg := fmt.Sprintf("[%s] Auto-reajuste #%d (%s ×%d): %d → %d %s (%s)",
							acc.Nick, adID, itemLabel, adQty, curPrice, dec.Price, moeda, res.Detail)
						_ = ms.store.AppendMarketLog(acc.ID, rule.ID, "reprice_"+res.Status, msg)
						if eErr != nil {
							log.Printf("[auto-sell] %s err=%v", msg, eErr)
						}
					}
				}

				// 2. Check bag excess to create a new listing (respecting bound units in automation.itensPresos)
				stock := mapIntValue(asMap(snap.Estado["items"]), spec.ItemID)
				bound := 0
				if auto := asMap(snap.Estado["automation"]); auto != nil {
					bound = mapIntValue(asMap(auto["itensPresos"]), spec.ItemID)
				}
				keep := spec.KeepQty
				if keep < 0 {
					keep = 0
				}
				minLot := spec.MinSellQty
				if minLot <= 0 {
					minLot = 1
				}
				excess, freeUnits := ComputeSellableItemExcess(stock, bound, keep)
				if stock-keep >= minLot && freeUnits < minLot {
					previews = append(previews, AutoSellPreviewItem{
						RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
						Action: "blocked", Target: "item", Label: itemLabel, Qty: stock - keep, Moeda: moeda,
						Reason: fmt.Sprintf("itens presos (comprados no mercado): %d presos, apenas %d livres", bound, freeUnits),
					})
					continue
				}
				if excess < minLot {
					continue
				}
				maxAds := spec.MaxActiveAds
				if maxAds <= 0 {
					maxAds = 1
				}
				if activeItemAds >= maxAds {
					previews = append(previews, AutoSellPreviewItem{
						RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
						Action: "hold", Target: "item", Label: itemLabel, Qty: excess, Moeda: moeda,
						MarketFloor: dec.MarketFloor, RefAvg: dec.RefAvg, HardFloor: dec.HardFloor,
						Reason: fmt.Sprintf("já existem %d/%d anúncios abertos", activeItemAds, maxAds),
					})
					continue
				}
				if !dec.ShouldList {
					previews = append(previews, AutoSellPreviewItem{
						RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
						Action: "hold", Target: "item", Label: itemLabel, Qty: excess, Moeda: moeda,
						MarketFloor: dec.MarketFloor, RefAvg: dec.RefAvg, HardFloor: dec.HardFloor,
						Reason: dec.Reason,
					})
					continue
				}
				if NetMarketProceeds(dec.Price, excess, moeda, "item") < 1 {
					previews = append(previews, AutoSellPreviewItem{
						RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
						Action: "blocked", Target: "item", Label: itemLabel, Qty: excess, Price: dec.Price, Moeda: moeda,
						Reason: "valor líquido após taxa de 15% seria zero",
					})
					continue
				}

				previews = append(previews, AutoSellPreviewItem{
					RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
					Action: "create", Target: "item", Label: itemLabel, Qty: excess, Price: dec.Price, Moeda: moeda,
					MarketFloor: dec.MarketFloor, RefAvg: dec.RefAvg, HardFloor: dec.HardFloor,
					Reason: dec.Reason,
				})
				if !dryRun && actionsByAcc[acc.ID] < autoSellMaxActionsPerAcc {
					res, cErr := c.market.CreateListing(ctx, CreateListingRequest{
						Tipo:   "item",
						ItemID: spec.ItemID,
						Qty:    excess,
						Price:  dec.Price,
						Moeda:  moeda,
					})
					actionsByAcc[acc.ID]++
					msg := fmt.Sprintf("[%s] Auto-venda %dx %s @ %d %s: %s",
						acc.Nick, excess, itemLabel, dec.Price, moeda, res.Detail)
					_ = ms.store.AppendMarketLog(acc.ID, rule.ID, "autosell_"+res.Status, msg)
					if cErr != nil {
						log.Printf("[auto-sell] %s err=%v", msg, cErr)
					} else if res.Status == "ok" {
						_ = ms.store.RecordSellRuleFire(rule.ID, 1)
						ms.mgr.Notifier().Send(DiscordEmbed{
							Title:       fmt.Sprintf("🏷️ Auto-Venda — %s", acc.Nick),
							Description: fmt.Sprintf("Anunciou **%dx %s** por **%s %s** (%s)", excess, itemLabel, formatIntPT(dec.Price), moedaLabelOf(moeda), dec.Reason),
							Color:       ColorBlue,
						})
					}
				}
				continue
			}

			// --- Target == "pokemon" ---
			activePokeAds := 0
			for _, ad := range myAds {
				if asString(ad["tipo"]) != "pokemon" {
					continue
				}
				st := asString(ad["estado"])
				if st != "" && st != "aberto" {
					continue
				}
				activePokeAds++

				adID := asInt(ad["id"])
				if !spec.RepriceEnabled || repricedListingIDs[adID] {
					continue
				}
				adMoeda := asString(ad["moeda"])
				if adMoeda == "" {
					adMoeda = "gold"
				}
				if adMoeda != moeda {
					continue
				}
				ficha := asMap(ad["ficha"])
				if ficha == nil {
					ficha = asMap(ad["pokemon"])
				}
				if ficha == nil {
					continue
				}
				pkDet := BuildPokemonDetailWithCatalog(acc.ID, acc.Nick, 0, ficha, ms.mgr.creatures)
				if !pokemonMatchesSellSpec(pkDet, spec) {
					continue
				}
				refMed, _ := ms.lookupPokemonMedian(ctx, c, pkDet.Name, moeda, pkDet.Shiny)
				mFloor := getPokemonFloor(c, pkDet, moeda, refMed)
				dec := ComputeSellPrice(spec, mFloor, refMed, minAllowed)
				if !dec.ShouldList {
					continue
				}
				okReprice, rReason := ShouldRepriceListing(ad, dec.Price, spec.RepriceMinDiffPct, nowMs)
				if !okReprice {
					continue
				}
				repricedListingIDs[adID] = true
				curPrice := asInt64(ad["preco"])
				pkLabel := formatPokemonSellLabel(pkDet)
				previews = append(previews, AutoSellPreviewItem{
					RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
					Action: "reprice", Target: "pokemon", Label: pkLabel,
					ListingID: adID, Qty: 1, CurrentPrice: curPrice, Price: dec.Price, Moeda: moeda,
					MarketFloor: dec.MarketFloor, RefAvg: dec.RefAvg, HardFloor: dec.HardFloor,
					Reason: rReason,
				})
				if !dryRun && actionsByAcc[acc.ID] < autoSellMaxActionsPerAcc {
					res, eErr := c.market.EditListing(ctx, adID, dec.Price, moeda)
					actionsByAcc[acc.ID]++
					msg := fmt.Sprintf("[%s] Auto-reajuste #%d (%s): %d → %d %s (%s)",
						acc.Nick, adID, pkLabel, curPrice, dec.Price, moeda, res.Detail)
					_ = ms.store.AppendMarketLog(acc.ID, rule.ID, "reprice_"+res.Status, msg)
					if eErr != nil {
						log.Printf("[auto-sell] %s err=%v", msg, eErr)
					}
				}
			}

			// 2. Excess Pokémon from PC Box
			activeID := asInt(snap.Estado["activeId"])
			rawSlice := asSlice(snap.Estado["pokemons"])
			allPks := make([]PokemonDetail, 0, len(rawSlice))
			rawByID := make(map[int]map[string]any, len(rawSlice))
			for _, raw := range rawSlice {
				pm := asMap(raw)
				if pm == nil {
					continue
				}
				det := BuildPokemonDetailWithCatalog(acc.ID, acc.Nick, activeID, pm, ms.mgr.creatures)
				allPks = append(allPks, det)
				rawByID[det.ID] = pm
			}

			candidates := SelectExcessPokemons(allPks, rawByID, spec)
			if len(candidates) == 0 {
				continue
			}

			days := spec.Days
			if days < 1 {
				days = 3
			}
			if days > 30 {
				days = 30
			}
			stayFee := limits.TaxaDiaria * int64(days)
			availGold := asInt64(snap.Estado["gold"])

			for _, pk := range candidates {
				if !dryRun && actionsByAcc[acc.ID] >= autoSellMaxActionsPerAcc {
					break
				}
				pkLabel := formatPokemonSellLabel(pk)
				pkMoeda := moeda
				if pk.Shiny {
					pkMoeda = "orb"
				}
				if activePokeAds >= limits.MaxAnunciosPokemon {
					previews = append(previews, AutoSellPreviewItem{
						RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
						Action: "hold", Target: "pokemon", Label: pkLabel, Qty: 1, Moeda: pkMoeda,
						Reason: fmt.Sprintf("limite de anúncios Pokémon atingido (%d/%d)", activePokeAds, limits.MaxAnunciosPokemon),
					})
					break
				}
				if availGold-stayFee < spec.GoldFloor {
					previews = append(previews, AutoSellPreviewItem{
						RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
						Action: "hold", Target: "pokemon", Label: pkLabel, Qty: 1, Moeda: pkMoeda,
						Reason: fmt.Sprintf("Gold insuficiente para estadia (%s) mantendo piso (%s)", formatIntPT(stayFee), formatIntPT(spec.GoldFloor)),
					})
					break
				}

				refMed, _ := ms.lookupPokemonMedian(ctx, c, pk.Name, pkMoeda, pk.Shiny)
				mFloor := getPokemonFloor(c, pk, pkMoeda, refMed)
				dec := ComputeSellPrice(spec, mFloor, refMed, limits.MinPriceFor(pkMoeda))
				if !dec.ShouldList {
					previews = append(previews, AutoSellPreviewItem{
						RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
						Action: "hold", Target: "pokemon", Label: pkLabel, Qty: 1, Moeda: pkMoeda,
						MarketFloor: dec.MarketFloor, RefAvg: dec.RefAvg, HardFloor: dec.HardFloor,
						Reason: dec.Reason,
					})
					continue
				}
				if NetMarketProceeds(dec.Price, 1, pkMoeda, "pokemon") < 1 {
					continue
				}

				previews = append(previews, AutoSellPreviewItem{
					RuleID: rule.ID, AccountID: acc.ID, AccountNick: acc.Nick,
					Action: "create", Target: "pokemon", Label: pkLabel, Qty: 1, Price: dec.Price, Moeda: pkMoeda,
					MarketFloor: dec.MarketFloor, RefAvg: dec.RefAvg, HardFloor: dec.HardFloor,
					Reason: fmt.Sprintf("%s (%dd, taxa %s Gold)", dec.Reason, days, formatIntPT(stayFee)),
				})
				availGold -= stayFee
				activePokeAds++

				if !dryRun {
					res, cErr := c.market.CreateListing(ctx, CreateListingRequest{
						Tipo:      "pokemon",
						PokemonID: pk.ID,
						Qty:       1,
						Price:     dec.Price,
						Moeda:     pkMoeda,
						Days:      days,
					})
					actionsByAcc[acc.ID]++
					msg := fmt.Sprintf("[%s] Auto-venda %s @ %d %s (%dd): %s",
						acc.Nick, pkLabel, dec.Price, pkMoeda, days, res.Detail)
					_ = ms.store.AppendMarketLog(acc.ID, rule.ID, "autosell_"+res.Status, msg)
					if cErr != nil {
						log.Printf("[auto-sell] %s err=%v", msg, cErr)
					} else if res.Status == "ok" {
						_ = ms.store.RecordSellRuleFire(rule.ID, 1)
						ms.mgr.Notifier().Send(DiscordEmbed{
							Title:       fmt.Sprintf("🏷️ Auto-Venda Pokémon — %s", acc.Nick),
							Description: fmt.Sprintf("Anunciou **%s** por **%s %s** (%dd · %s)", pkLabel, formatIntPT(dec.Price), moedaLabelOf(pkMoeda), days, dec.Reason),
							Color:       ColorBlue,
						})
					} else if res.Status == "limite" {
						break
					}
				}
			}
		}
	}

	if previews == nil {
		previews = []AutoSellPreviewItem{}
	}
	return previews, nil
}

func formatPokemonSellLabel(pk PokemonDetail) string {
	prefix := ""
	if pk.Shiny {
		prefix = "Shiny "
	}
	return fmt.Sprintf("%s%s Lv%d (Nota %.1f · IV %d)", prefix, pk.Name, pk.Level, pk.Grade, pk.IVSum)
}

func moedaLabelOf(moeda string) string {
	if moeda == "orb" {
		return "Gemas"
	}
	return "Gold"
}
