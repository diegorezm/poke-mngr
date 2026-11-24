package pokeidle

import (
	"context"
	"fmt"
	"sort"
	"strconv"
)

type InventoryItemAccountQty struct {
	AccountID int    `json:"accountId"`
	Nick      string `json:"nick"`
	Qty       int    `json:"qty"`
}

type InventoryItemEntry struct {
	ID       int                       `json:"id"`
	Kind     string                    `json:"kind"` // ball | potion | rare | item
	Name     string                    `json:"nome"`
	Icon     string                    `json:"icon"`
	Total    int                       `json:"total"`
	Accounts []InventoryItemAccountQty `json:"accounts"`
}

type InventorySummary struct {
	TotalGold     int64                `json:"totalGold"`
	TotalOrbs     int64                `json:"totalOrbs"`
	TotalDiamonds int64                `json:"totalDiamonds"`
	TotalPokemons int                  `json:"totalPokemons"`
	TotalShinies  int                  `json:"totalShinies"`
	Items         []InventoryItemEntry `json:"items"`
}

var SpecialItemMeta = map[int]struct {
	Name string
	Kind string
	Icon string
}{
	200:   {"Small Potion", "potion", "https://pokeidle.io/assets/site/assets/markitems/small_potion.png"},
	201:   {"Great Potion", "potion", "https://pokeidle.io/assets/site/assets/markitems/great_potion.png"},
	202:   {"Ultra Potion", "potion", "https://pokeidle.io/assets/site/assets/markitems/ultra_potion.png"},
	203:   {"Hyper Potion", "potion", "https://pokeidle.io/assets/site/assets/markitems/hyper_potion.png"},
	204:   {"Ultimate Potion", "potion", "https://pokeidle.io/assets/site/assets/markitems/ultimate_potion.png"},
	205:   {"Revive", "potion", "https://pokeidle.io/assets/site/assets/markitems/revive.png"},
	206:   {"Max Revive", "potion", "https://pokeidle.io/assets/site/assets/markitems/max_revive.png"},
	70000: {"Bronze Boss Token", "rare", "https://pokeidle.io/assets/site/assets/items/bronze_boss_token.png"},
	70010: {"Escape Rope", "rare", "https://pokeidle.io/img/itens/escape-rope.png"},
	70011: {"Fragmento de Chave", "rare", "https://pokeidle.io/img/itens/fragmento-chave.png"},
	70012: {"Fragmento de Shiny Stone", "rare", "https://pokeidle.io/img/itens/shiny-stone.png"},
	70013: {"Fragmento de Bicicleta", "rare", "https://pokeidle.io/img/itens/fragmento-bicicleta.png"},
	70070: {"Golden Potion", "potion", "https://pokeidle.io/img/itens/golden-potion.png"},
}

var BallIcons = map[int]string{
	1: "https://pokeidle.io/assets/site/assets/ui/ball-poke.png",
	2: "https://pokeidle.io/assets/site/assets/ui/ball-great.png",
	3: "https://pokeidle.io/img/ball-super.png",
	4: "https://pokeidle.io/assets/site/assets/ui/ball-ultra.png",
	5: "https://pokeidle.io/img/ball-beast.png",
}

func (m *AccountManager) BuildInventory(accountID int) InventorySummary {
	m.mu.RLock()
	conns := make([]*AccountConnection, 0, len(m.conns))
	for _, c := range m.conns {
		if accountID == 0 || c.Account().ID == accountID {
			conns = append(conns, c)
		}
	}
	m.mu.RUnlock()

	sort.Slice(conns, func(i, j int) bool { return conns[i].Account().OrderIndex < conns[j].Account().OrderIndex })

	var sum InventorySummary
	byKey := map[string]*InventoryItemEntry{}

	addEntry := func(key string, id int, kind, name, icon string, accID int, nick string, qty int) {
		if qty <= 0 {
			return
		}
		e := byKey[key]
		if e == nil {
			e = &InventoryItemEntry{ID: id, Kind: kind, Name: name, Icon: icon}
			byKey[key] = e
		}
		e.Total += qty
		e.Accounts = append(e.Accounts, InventoryItemAccountQty{
			AccountID: accID,
			Nick:      nick,
			Qty:       qty,
		})
	}

	for _, c := range conns {
		c.mu.RLock()
		acc := c.acc
		est := c.hunt.Estado
		itensNossos := c.itensNossos
		c.mu.RUnlock()

		sum.TotalGold += asInt64(est["gold"])
		sum.TotalOrbs += asInt64(est["orbs"])
		sum.TotalDiamonds += asInt64(est["diamonds"])
		for _, raw := range asSlice(est["pokemons"]) {
			sum.TotalPokemons++
			if pm := asMap(raw); pm != nil && asBool(pm["shiny"]) {
				sum.TotalShinies++
			}
		}

		for k, v := range asMap(est["balls"]) {
			bid, err := strconv.Atoi(k)
			if err != nil {
				continue
			}
			qty := asInt(v)
			name := BallNames[bid]
			if name == "" {
				name = fmt.Sprintf("Ball #%d", bid)
			}
			addEntry(fmt.Sprintf("ball:%d", bid), bid, "ball", name, BallIcons[bid], acc.ID, acc.Nick, qty)
		}

		for k, v := range asMap(est["items"]) {
			iid, err := strconv.Atoi(k)
			if err != nil {
				continue
			}
			qty := asInt(v)
			kind := "item"
			name := fmt.Sprintf("Item #%d", iid)
			icon := ""
			if dm, ok := m.catalog.Display(iid); ok {
				if dm.Name != "" {
					name = dm.Name
				}
				if dm.Icon != "" {
					icon = dm.Icon
				}
				if dm.Rare {
					kind = "rare"
				} else if dm.Category == "potion" {
					kind = "potion"
				}
			}
			if sm, ok := SpecialItemMeta[iid]; ok {
				name = sm.Name
				kind = sm.Kind
				icon = sm.Icon
			} else if srv := itensNossos[iid]; srv != nil {
				if n := asString(srv["nome"]); n != "" {
					name = formatItemDisplayName(n)
				}
				if ic := asString(srv["icone"]); ic != "" {
					icon = fullAssetURL(ic)
				}
				if iid >= 70000 {
					kind = "rare"
				}
			}
			addEntry(fmt.Sprintf("item:%d", iid), iid, kind, name, icon, acc.ID, acc.Nick, qty)
		}
	}

	kindOrder := map[string]int{"rare": 0, "ball": 1, "potion": 2, "item": 3}
	items := make([]InventoryItemEntry, 0, len(byKey))
	for _, e := range byKey {
		items = append(items, *e)
	}
	sort.Slice(items, func(i, j int) bool {
		if kindOrder[items[i].Kind] != kindOrder[items[j].Kind] {
			return kindOrder[items[i].Kind] < kindOrder[items[j].Kind]
		}
		if items[i].Total != items[j].Total {
			return items[i].Total > items[j].Total
		}
		return items[i].ID < items[j].ID
	})
	sum.Items = items
	return sum
}

func (m *AccountManager) ListPokemons(accountID int, sortBy string) []PokemonDetail {
	m.creatures.EnsureLoaded(context.Background())

	m.mu.RLock()
	conns := make([]*AccountConnection, 0, len(m.conns))
	for _, c := range m.conns {
		if accountID == 0 || c.Account().ID == accountID {
			conns = append(conns, c)
		}
	}
	m.mu.RUnlock()

	out := []PokemonDetail{}
	for _, c := range conns {
		c.mu.RLock()
		accID := c.acc.ID
		accNick := c.acc.Nick
		activeID := asInt(c.hunt.Estado["activeId"])
		pks := asSlice(c.hunt.Estado["pokemons"])
		for _, raw := range pks {
			if pm := asMap(raw); pm != nil {
				out = append(out, BuildPokemonDetailWithCatalog(accID, accNick, activeID, pm, m.creatures))
			}
		}
		c.mu.RUnlock()
	}
	SortPokemons(out, sortBy)
	return out
}

type ActivePokemonSheet struct {
	ID           int            `json:"id"`
	SpeciesID    int            `json:"speciesId"`
	Name         string         `json:"nome"`
	Looktype     int            `json:"looktype"`
	Level        int            `json:"level"`
	Shiny        bool           `json:"shiny"`
	Quality      float64        `json:"quality"`
	Potencia     int            `json:"potencia"`
	Stats        map[string]int `json:"stats"`
	IVs          map[string]int `json:"ivs"`
	TmAoe        bool           `json:"tmAoe"`
	TrainerLevel int            `json:"trainerLevel"`
}

func (m *AccountManager) GetActivePokemonSheet(accountID int) (*ActivePokemonSheet, error) {
	conn := m.GetConnection(accountID)
	if conn == nil {
		return nil, fmt.Errorf("conta não encontrada")
	}
	conn.mu.RLock()
	defer conn.mu.RUnlock()

	pk := conn.hunt.ActivePokemon()
	if pk == nil {
		return nil, fmt.Errorf("nenhum Pokémon equipado")
	}
	statsRaw := asMap(pk["stats"])
	ivsRaw := asMap(pk["ivs"])
	if statsRaw == nil || ivsRaw == nil {
		return nil, fmt.Errorf("ficha do Pokémon equipado ainda não carregou")
	}

	stats := map[string]int{}
	ivs := map[string]int{}
	for _, k := range statKeys {
		stats[k] = asInt(statsRaw[k])
		ivs[k] = asInt(ivsRaw[k])
	}
	speciesID := asInt(pk["speciesId"])
	if speciesID == 0 {
		speciesID = asInt(pk["pokeId"])
	}
	q := asFloat(pk["quality"])
	if q == 0 {
		q = asFloat(pk["qualidade"])
	}
	if q == 0 {
		q = 1.0
	}
	pot := asInt(pk["potencia"])
	if pot <= 0 {
		pot = 1
	}
	lv := asInt(pk["level"])
	if lv <= 0 {
		lv = 1
	}
	trainerLv := asInt(conn.hunt.Estado["level"])
	if trainerLv <= 0 {
		trainerLv = 1
	}
	name := asString(pk["nome"])
	if name == "" {
		name = asString(pk["especie"])
	}

	return &ActivePokemonSheet{
		ID:           asInt(pk["id"]),
		SpeciesID:    speciesID,
		Name:         name,
		Looktype:     lookOf(pk),
		Level:        lv,
		Shiny:        asBool(pk["shiny"]),
		Quality:      q,
		Potencia:     pot,
		Stats:        stats,
		IVs:          ivs,
		TmAoe:        asBool(pk["tmAoe"]),
		TrainerLevel: trainerLv,
	}, nil
}

func (m *AccountManager) BuildHuntsCatalog(accountID int) HuntsCatalog {
	var conn *AccountConnection
	if accountID > 0 {
		conn = m.GetConnection(accountID)
	}
	if conn == nil {
		m.mu.RLock()
		for _, c := range m.conns {
			if conn == nil || c.Snapshot().State == StateOnline {
				conn = c
				if c.Snapshot().State == StateOnline {
					break
				}
			}
		}
		m.mu.RUnlock()
	}
	if conn == nil {
		return HuntsCatalog{OutlandTiers: DefaultOutlandTiers, Hunts: []HuntInfo{}}
	}
	m.creatures.EnsureLoaded(context.Background())
	snap := conn.Snapshot()
	conn.mu.RLock()
	hunts := BuildHuntInfoList(conn.hunts, m.creatures)
	tiers := NormalizeOutlandTiers(conn.outlandTiers)
	conn.mu.RUnlock()

	return HuntsCatalog{
		AccountID:    snap.ID,
		AccountLevel: snap.Level,
		ActiveSlug:   snap.Hunt.Slug,
		PendingSlug:  snap.Hunt.PendingSlug,
		CombatLockMs: snap.Hunt.CombatLockMs,
		OutlandTier:  snap.Hunt.OutlandTier,
		OutlandTiers: tiers,
		Hunts:        hunts,
	}
}
