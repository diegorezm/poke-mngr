package pokeidle

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"poke-mngr/internal/config"
)

// ItemCatalog caches /assets/items.json for NPC potion/revive prices & heal values.
type ItemCatalog struct {
	mu      sync.RWMutex
	potions []ShopItemMeta
	revives []ShopItemMeta
	byID    map[int]ShopItemMeta
	loaded  time.Time
}

func NewItemCatalog() *ItemCatalog {
	ic := &ItemCatalog{
		potions: append([]ShopItemMeta(nil), DefaultNPCPotions...),
		byID:    map[int]ShopItemMeta{},
	}
	for _, p := range ic.potions {
		ic.byID[p.ID] = p
	}
	return ic
}

func (ic *ItemCatalog) EnsureLoaded(ctx context.Context) {
	ic.mu.RLock()
	fresh := time.Since(ic.loaded) < 6*time.Hour && !ic.loaded.IsZero()
	ic.mu.RUnlock()
	if fresh {
		return
	}
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, config.SiteOrigin+"/assets/items.json", nil)
	if err != nil {
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return
	}
	var raw any
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return
	}

	var entries []map[string]any
	if sl := asSlice(raw); sl != nil {
		for _, x := range sl {
			if m := asMap(x); m != nil {
				entries = append(entries, m)
			}
		}
	} else if mp := asMap(raw); mp != nil {
		for _, v := range mp {
			if m := asMap(v); m != nil {
				entries = append(entries, m)
			}
		}
	}

	ic.mu.Lock()
	defer ic.mu.Unlock()
	var potions []ShopItemMeta
	var revives []ShopItemMeta
	for _, it := range entries {
		id := asInt(it["id"])
		if id <= 0 {
			continue
		}
		price := asInt64(it["preco"])
		if price == 0 {
			price = asInt64(it["price"])
		}
		name := asString(it["nome"])
		if name == "" {
			name = asString(it["name"])
		}
		tipo := strings.ToLower(asString(it["tipo"]))
		if tipo == "" {
			tipo = strings.ToLower(asString(it["type"]))
		}
		meta := ShopItemMeta{
			ID:      id,
			Kind:    "item",
			Name:    name,
			Price:   price,
			HealHP:  asInt(it["cura"]),
			HealPct: asFloat(it["curaPct"]),
		}
		if strings.Contains(tipo, "revive") || strings.Contains(strings.ToLower(name), "revive") {
			meta.IsRevive = true
			if price > 0 {
				revives = append(revives, meta)
			}
		} else if config.KnownPotionIDs[id] {
			potions = append(potions, meta)
		}
		ic.byID[id] = meta
	}
	if len(potions) > 0 {
		ic.potions = potions
	}
	if len(revives) > 0 {
		ic.revives = revives
	}
	ic.loaded = time.Now()
}

func (ic *ItemCatalog) UnitPrice(kind string, id int) int64 {
	if kind == "ball" {
		return DefaultNPCBalls[id]
	}
	ic.mu.RLock()
	defer ic.mu.RUnlock()
	if m, ok := ic.byID[id]; ok {
		return m.Price
	}
	return 0
}

func (ic *ItemCatalog) CheapestRevive() (int, int64) {
	ic.mu.RLock()
	defer ic.mu.RUnlock()
	bestID := 0
	var bestPrice int64 = math.MaxInt64
	for _, r := range ic.revives {
		if r.Price > 0 && r.Price < bestPrice {
			bestID = r.ID
			bestPrice = r.Price
		}
	}
	if bestID == 0 {
		return 0, 0
	}
	return bestID, bestPrice
}

func (ic *ItemCatalog) TotalRevives(items map[string]any) int {
	ic.mu.RLock()
	defer ic.mu.RUnlock()
	total := 0
	for _, r := range ic.revives {
		total += mapIntValue(items, r.ID)
	}
	return total
}

// BestCostPotion mirrors pokeidleDeck's gold-per-useful-HP calculation.
func (ic *ItemCatalog) BestCostPotion(maxHP int, hpThreshold float64) int {
	if maxHP <= 0 {
		return 204
	}
	if hpThreshold <= 0 || hpThreshold >= 1 {
		hpThreshold = 0.5
	}
	missing := float64(maxHP) * (1.0 - hpThreshold)
	if missing < 1 {
		missing = float64(maxHP) * 0.5
	}
	ic.mu.RLock()
	defer ic.mu.RUnlock()

	bestID := 204
	bestCost := math.MaxFloat64
	for _, p := range ic.potions {
		if p.Price <= 0 {
			continue
		}
		heal := float64(p.HealHP)
		if p.HealPct > 0 {
			heal = float64(maxHP) * p.HealPct
		}
		if heal <= 0 {
			continue
		}
		useful := math.Min(heal, missing)
		costPerHP := float64(p.Price) / useful
		if costPerHP < bestCost {
			bestCost = costPerHP
			bestID = p.ID
		}
	}
	return bestID
}

// --- Sprite Atlas & Outfit Proxy ---

type OutfitSprite struct {
	Image string `json:"image"`
	PageW int    `json:"pageW"`
	PageH int    `json:"pageH"`
	X     int    `json:"x"`
	Y     int    `json:"y"`
	W     int    `json:"w"`
	H     int    `json:"h"`
}

type spriteCacheEntry struct {
	data *OutfitSprite
	exp  time.Time
}

type SpriteProxy struct {
	client *http.Client

	atlasMu  sync.Mutex
	atlasRaw []byte
	atlasExp time.Time

	idxMu  sync.Mutex
	idx    map[string]map[string]any
	idxExp time.Time

	cacheMu sync.Mutex
	cache   map[int]spriteCacheEntry
}

func NewSpriteProxy() *SpriteProxy {
	return &SpriteProxy{
		client: &http.Client{Timeout: 15 * time.Second},
		cache:  map[int]spriteCacheEntry{},
	}
}

func (sp *SpriteProxy) GetAtlas(ctx context.Context) ([]byte, error) {
	sp.atlasMu.Lock()
	defer sp.atlasMu.Unlock()
	if len(sp.atlasRaw) > 0 && time.Now().Before(sp.atlasExp) {
		return sp.atlasRaw, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, config.SiteOrigin+"/assets/site/assets/maps/marker-atlas.json", nil)
	if err != nil {
		return nil, err
	}
	resp, err := sp.client.Do(req)
	if err != nil {
		if len(sp.atlasRaw) > 0 {
			return sp.atlasRaw, nil
		}
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("atlas HTTP %d", resp.StatusCode)
	}
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	sp.atlasRaw = b
	sp.atlasExp = time.Now().Add(5 * time.Minute)
	return b, nil
}

func localizePackPath(p string) string {
	if strings.HasPrefix(p, "/assets-packs") {
		return "/assets/asset-packs" + strings.TrimPrefix(p, "/assets-packs")
	}
	return p
}

func (sp *SpriteProxy) loadOutfitIndex(ctx context.Context) (map[string]map[string]any, error) {
	sp.idxMu.Lock()
	defer sp.idxMu.Unlock()
	if sp.idx != nil && time.Now().Before(sp.idxExp) {
		return sp.idx, nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, config.SiteOrigin+"/assets/asset-packs/outfits-index.json", nil)
	if err != nil {
		return nil, err
	}
	resp, err := sp.client.Do(req)
	if err != nil {
		if sp.idx != nil {
			return sp.idx, nil
		}
		return nil, err
	}
	defer resp.Body.Close()
	var parsed map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}
	outfits := map[string]map[string]any{}
	for k, v := range asMap(parsed["outfits"]) {
		if m := asMap(v); m != nil {
			outfits[k] = m
		}
	}
	sp.idx = outfits
	sp.idxExp = time.Now().Add(time.Hour)
	return sp.idx, nil
}

func (sp *SpriteProxy) GetOutfit(ctx context.Context, looktype int) (*OutfitSprite, error) {
	sp.cacheMu.Lock()
	if e, ok := sp.cache[looktype]; ok && time.Now().Before(e.exp) {
		sp.cacheMu.Unlock()
		return e.data, nil
	}
	sp.cacheMu.Unlock()

	idx, err := sp.loadOutfitIndex(ctx)
	if err != nil {
		return nil, err
	}
	entry := idx[strconv.Itoa(looktype)]
	if entry == nil {
		sp.putCache(looktype, nil, 5*time.Minute)
		return nil, nil
	}
	manifestPath := localizePackPath(asString(entry["manifest"]))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, config.SiteOrigin+manifestPath, nil)
	if err != nil {
		return nil, err
	}
	resp, err := sp.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		sp.putCache(looktype, nil, 5*time.Minute)
		return nil, nil
	}
	var manifest map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&manifest); err != nil {
		return nil, err
	}

	frame := pickFrontFrame(manifest)
	if frame == nil {
		sp.putCache(looktype, nil, 5*time.Minute)
		return nil, nil
	}
	var pages []any
	for _, v := range asMap(manifest["categories"]) {
		if cat := asMap(v); cat != nil {
			pages = asSlice(cat["pages"])
			break
		}
	}
	if frame.page < 0 || frame.page >= len(pages) {
		sp.putCache(looktype, nil, 5*time.Minute)
		return nil, nil
	}
	pageMap := asMap(pages[frame.page])
	res := &OutfitSprite{
		Image: config.SiteOrigin + localizePackPath(asString(pageMap["image"])),
		PageW: asInt(pageMap["width"]),
		PageH: asInt(pageMap["height"]),
		X:     frame.x,
		Y:     frame.y,
		W:     frame.w,
		H:     frame.h,
	}
	sp.putCache(looktype, res, 6*time.Hour)
	return res, nil
}

func (sp *SpriteProxy) putCache(looktype int, data *OutfitSprite, ttl time.Duration) {
	sp.cacheMu.Lock()
	defer sp.cacheMu.Unlock()
	if len(sp.cache) > 2000 {
		for k := range sp.cache {
			delete(sp.cache, k)
			break
		}
	}
	sp.cache[looktype] = spriteCacheEntry{data: data, exp: time.Now().Add(ttl)}
}

type frameBox struct {
	page, x, y, w, h int
}

func pickFrontFrame(manifest map[string]any) *frameBox {
	const frontDir = 3
	byDir := map[int]map[int]frameBox{}
	for key, raw := range asMap(manifest["assets"]) {
		asset := asMap(raw)
		if asset == nil {
			continue
		}
		idx := strings.LastIndex(key, "/")
		stem := key
		if idx >= 0 {
			stem = key[idx+1:]
		}
		stem = strings.TrimSuffix(stem, ".png")
		if strings.HasSuffix(stem, "_template") {
			continue
		}
		parts := strings.Split(stem, "_")
		if len(parts) < 4 {
			continue
		}
		seq, err1 := strconv.Atoi(parts[0])
		dir, err2 := strconv.Atoi(parts[3])
		if err1 != nil || err2 != nil {
			continue
		}
		frames := asSlice(asset["frames"])
		if len(frames) == 0 {
			continue
		}
		f := asMap(frames[0])
		if f == nil {
			continue
		}
		if byDir[dir] == nil {
			byDir[dir] = map[int]frameBox{}
		}
		byDir[dir][seq] = frameBox{
			page: asInt(f["page"]),
			x:    asInt(f["x"]),
			y:    asInt(f["y"]),
			w:    asInt(f["w"]),
			h:    asInt(f["h"]),
		}
	}
	if len(byDir) == 0 {
		return nil
	}
	chosen := byDir[frontDir]
	if chosen == nil {
		for _, m := range byDir {
			chosen = m
			break
		}
	}
	minSeq := math.MaxInt
	var box frameBox
	for seq, b := range chosen {
		if seq < minSeq {
			minSeq = seq
			box = b
		}
	}
	return &box
}
