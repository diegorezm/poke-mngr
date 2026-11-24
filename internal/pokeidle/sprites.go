package pokeidle

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"poke-mngr/internal/config"
)

type ItemDisplayMeta struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Icon     string `json:"icon"`
	Category string `json:"category"`
	Rare     bool   `json:"rare"`
	NPCPrice int64  `json:"npcPrice"`
}

var (
	zmovePieceRe = regexp.MustCompile(`(AoE )?\bTM Disk Piece\b`)
	zmoveDiskRe  = regexp.MustCompile(`\b([A-Za-z]+)-Type TM Disk\b( Piece)?`)
	zmoveTypes   = map[string]bool{
		"normal": true, "fire": true, "water": true, "grass": true, "electric": true, "ice": true,
		"fighting": true, "poison": true, "ground": true, "flying": true, "psychic": true,
		"bug": true, "rock": true, "ghost": true, "dragon": true, "dark": true, "steel": true, "fairy": true,
	}
)

func formatItemDisplayName(raw string) string {
	if !strings.Contains(raw, "TM Disk") {
		return raw
	}
	s := zmovePieceRe.ReplaceAllStringFunc(raw, func(m string) string {
		if strings.HasPrefix(m, "AoE ") {
			return m
		}
		return "Fragmento de Z-Move"
	})
	return zmoveDiskRe.ReplaceAllStringFunc(s, func(m string) string {
		if strings.HasSuffix(m, " Piece") {
			return m
		}
		sub := zmoveDiskRe.FindStringSubmatch(m)
		if len(sub) >= 2 {
			return "Z-Move " + strings.ToUpper(sub[1])
		}
		return m
	})
}

func zmoveIconOverride(id int, rawName string) string {
	switch id {
	case 59194:
		return config.SiteOrigin + "/img/itens/zmove/fragmento.png"
	case 40530:
		return config.SiteOrigin + "/img/itens/zmove/aoe-peca.png"
	case 40575:
		return config.SiteOrigin + "/img/itens/zmove/aoe-disco.png"
	}
	sub := zmoveDiskRe.FindStringSubmatch(rawName)
	if len(sub) >= 2 && sub[2] == "" {
		t := strings.ToLower(sub[1])
		if zmoveTypes[t] {
			return config.SiteOrigin + "/img/itens/zmove/" + t + ".png"
		}
	}
	return ""
}

func fullAssetURL(rel string) string {
	rel = strings.TrimSpace(rel)
	if rel == "" {
		return ""
	}
	if strings.HasPrefix(rel, "http://") || strings.HasPrefix(rel, "https://") {
		return rel
	}
	if strings.HasPrefix(rel, "/") {
		return config.SiteOrigin + rel
	}
	return config.SiteOrigin + "/assets/" + rel
}

// ItemCatalog caches /assets/items.json + /assets/items-icons.json for names, icons, and NPC prices.
type ItemCatalog struct {
	mu      sync.RWMutex
	potions []ShopItemMeta
	revives []ShopItemMeta
	byID    map[int]ShopItemMeta
	display map[int]ItemDisplayMeta
	loaded  time.Time
}

func NewItemCatalog() *ItemCatalog {
	ic := &ItemCatalog{
		potions: append([]ShopItemMeta(nil), DefaultNPCPotions...),
		byID:    map[int]ShopItemMeta{},
		display: map[int]ItemDisplayMeta{},
	}
	for _, p := range ic.potions {
		ic.byID[p.ID] = p
	}
	for id, sm := range SpecialItemMeta {
		ic.display[id] = ItemDisplayMeta{
			ID:       id,
			Name:     sm.Name,
			Icon:     sm.Icon,
			Category: sm.Kind,
			Rare:     sm.Kind == "rare",
		}
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
	fetchJSON := func(path string) any {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, config.SiteOrigin+path, nil)
		if err != nil {
			return nil
		}
		resp, err := client.Do(req)
		if err != nil {
			return nil
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return nil
		}
		var out any
		if json.NewDecoder(resp.Body).Decode(&out) != nil {
			return nil
		}
		return out
	}

	rawItems := fetchJSON("/assets/items.json")
	rawIcons := asMap(fetchJSON("/assets/items-icons.json"))
	if rawItems == nil {
		return
	}

	var entries []map[string]any
	if mp := asMap(rawItems); mp != nil {
		if list := asSlice(mp["items"]); list != nil {
			for _, x := range list {
				if m := asMap(x); m != nil {
					entries = append(entries, m)
				}
			}
		}
	} else if sl := asSlice(rawItems); sl != nil {
		for _, x := range sl {
			if m := asMap(x); m != nil {
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
		rawName := asString(it["name"])
		if rawName == "" {
			rawName = asString(it["nome"])
		}
		dispName := formatItemDisplayName(rawName)
		price := asInt64(it["npcPrice"])
		if price == 0 {
			price = asInt64(it["preco"])
		}
		if price == 0 {
			price = asInt64(it["price"])
		}
		cat := strings.ToLower(asString(it["category"]))
		if cat == "" {
			cat = strings.ToLower(asString(it["tipo"]))
		}
		icon := zmoveIconOverride(id, rawName)
		if icon == "" && rawIcons != nil {
			if rel := asString(rawIcons[strconv.Itoa(id)]); rel != "" {
				icon = fullAssetURL(rel)
			}
		}
		if icon == "" {
			if rel := asString(it["icon"]); rel != "" {
				if !strings.Contains(rel, "/") {
					rel = "site/assets/items/" + rel
				}
				icon = fullAssetURL(rel)
			}
		}
		if sm, ok := SpecialItemMeta[id]; ok {
			if dispName == "" {
				dispName = sm.Name
			}
			if icon == "" {
				icon = sm.Icon
			}
		}

		ic.display[id] = ItemDisplayMeta{
			ID:       id,
			Name:     dispName,
			Icon:     icon,
			Category: cat,
			Rare:     asBool(it["rare"]) || id >= 70000 || zmoveIconOverride(id, rawName) != "",
			NPCPrice: price,
		}

		meta := ShopItemMeta{
			ID:      id,
			Kind:    "item",
			Name:    dispName,
			Price:   price,
			HealHP:  asInt(it["cura"]),
			HealPct: asFloat(it["curaPct"]),
		}
		if strings.Contains(cat, "revive") || strings.Contains(strings.ToLower(rawName), "revive") {
			meta.IsRevive = true
			if price > 0 {
				revives = append(revives, meta)
			}
		} else if config.KnownPotionIDs[id] {
			potions = append(potions, meta)
		}
		ic.byID[id] = meta
	}

	// Ensure special server-only items (70010..70070) remain populated
	for id, sm := range SpecialItemMeta {
		cur := ic.display[id]
		if cur.Name == "" {
			cur.ID = id
			cur.Name = sm.Name
			cur.Category = sm.Kind
			cur.Rare = sm.Kind == "rare"
		}
		if cur.Icon == "" {
			cur.Icon = sm.Icon
		}
		ic.display[id] = cur
	}

	if len(potions) > 0 {
		ic.potions = potions
	}
	if len(revives) > 0 {
		ic.revives = revives
	}
	ic.loaded = time.Now()
}

func (ic *ItemCatalog) Display(id int) (ItemDisplayMeta, bool) {
	ic.mu.RLock()
	defer ic.mu.RUnlock()
	m, ok := ic.display[id]
	return m, ok
}

func (ic *ItemCatalog) AllDisplay() map[string]ItemDisplayMeta {
	ic.mu.RLock()
	defer ic.mu.RUnlock()
	out := make(map[string]ItemDisplayMeta, len(ic.display))
	for id, m := range ic.display {
		out[strconv.Itoa(id)] = m
	}
	return out
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

// --- CreatureCatalog (for hunt sprites, types, and loot — matches actions_api.py) ---

type CreatureMeta struct {
	PokeID   int
	Name     string
	Looktype int
	Types    []string
	Loot     []string
}

var outlandPrefixes = []string{
	"Brave ", "Tribal ", "Ancient ", "War ", "Furious ", "Charged ", "Magnetic ", "Evil ", "Freezing ", "Psy ",
	"Heavy ", "Milch-", "Roll ", "Hard ", "Brute ", "Enraged ", "Dark ", "Trickmaster ", "Banshee ",
	"Taekwondo ", "Enigmatic ", "Magma ", "Toxic ",
}

type CreatureCatalog struct {
	mu     sync.RWMutex
	byID   map[int]CreatureMeta
	byName map[string]CreatureMeta
	loaded time.Time
}

func NewCreatureCatalog() *CreatureCatalog {
	return &CreatureCatalog{
		byID:   map[int]CreatureMeta{},
		byName: map[string]CreatureMeta{},
	}
}

func (cc *CreatureCatalog) EnsureLoaded(ctx context.Context) {
	cc.mu.RLock()
	fresh := time.Since(cc.loaded) < 6*time.Hour && !cc.loaded.IsZero()
	cc.mu.RUnlock()
	if fresh {
		return
	}

	files := []string{
		"/assets/creatures.json",
		"/assets/creatures-novos.json",
		"/assets/creatures-outland-novos.json",
		"/assets/creatures-formas.json",
		"/assets/creatures-sprites-lab.json",
	}
	client := &http.Client{Timeout: 20 * time.Second}
	results := make([]map[string]any, len(files))
	var wg sync.WaitGroup
	for i, path := range files {
		wg.Add(1)
		go func(idx int, p string) {
			defer wg.Done()
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, config.SiteOrigin+p, nil)
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
			var m map[string]any
			if json.NewDecoder(resp.Body).Decode(&m) == nil {
				results[idx] = m
			}
		}(i, path)
	}
	wg.Wait()
	if results[0] == nil {
		return
	}

	byID := map[int]CreatureMeta{}
	byName := map[string]CreatureMeta{}
	for i := 0; i < 4; i++ {
		if results[i] == nil {
			continue
		}
		for _, raw := range asSlice(results[i]["creatures"]) {
			c := asMap(raw)
			if c == nil || c["pokeId"] == nil {
				continue
			}
			pid := asInt(c["pokeId"])
			if pid >= 10501 && pid < 10548 {
				pid = pid - (10501 - 2001)
			}
			if _, exists := byID[pid]; exists {
				continue
			}
			var tipos []string
			if t1 := strings.ToUpper(asString(c["type1"])); t1 != "" {
				tipos = append(tipos, t1)
			}
			if t2 := strings.ToUpper(asString(c["type2"])); t2 != "" {
				tipos = append(tipos, t2)
			}
			var loot []string
			for _, lr := range asSlice(c["loot"]) {
				if lm := asMap(lr); lm != nil {
					if ln := asString(lm["name"]); ln != "" {
						loot = append(loot, ln)
					}
				}
			}
			cm := CreatureMeta{
				PokeID:   pid,
				Name:     asString(c["name"]),
				Looktype: asInt(c["looktype"]),
				Types:    tipos,
				Loot:     loot,
			}
			byID[pid] = cm
			if pid <= 1025 && cm.Name != "" {
				byName[strings.ToLower(cm.Name)] = cm
			}
		}
	}

	// Apply creatures-sprites-lab.json looktype patches
	if lab := results[4]; lab != nil {
		for _, raw := range asSlice(lab["patches"]) {
			pm := asMap(raw)
			if pm == nil {
				continue
			}
			pid := asInt(pm["pokeId"])
			lt := asInt(pm["looktype"])
			if cm, ok := byID[pid]; ok && lt > 0 {
				cm.Looktype = lt
				byID[pid] = cm
				if pid <= 1025 && cm.Name != "" {
					byName[strings.ToLower(cm.Name)] = cm
				}
			}
		}
	}

	// Inherit base species looktype for Orre (13000..13999) and Outland (2001..2059)
	for pid, cm := range byID {
		var base CreatureMeta
		var ok bool
		if pid >= 13000 && pid < 14000 {
			base, ok = byID[pid-13000]
		} else if pid >= 2001 && pid <= 2059 {
			nm := strings.TrimSpace(cm.Name)
			for _, pre := range outlandPrefixes {
				if strings.HasPrefix(nm, pre) {
					nm = strings.TrimPrefix(nm, pre)
					break
				}
			}
			base, ok = byName[strings.ToLower(nm)]
		}
		if ok && base.Looktype > 1 {
			cm.Looktype = base.Looktype
			byID[pid] = cm
		}
	}

	cc.mu.Lock()
	cc.byID = byID
	cc.byName = byName
	cc.loaded = time.Now()
	cc.mu.Unlock()
}

func (cc *CreatureCatalog) Get(pokeID int) (CreatureMeta, bool) {
	if cc == nil {
		return CreatureMeta{}, false
	}
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	m, ok := cc.byID[pokeID]
	return m, ok
}

func (cc *CreatureCatalog) ByName(name string) (CreatureMeta, bool) {
	if cc == nil || name == "" {
		return CreatureMeta{}, false
	}
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	m, ok := cc.byName[strings.ToLower(strings.TrimSpace(name))]
	return m, ok
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
