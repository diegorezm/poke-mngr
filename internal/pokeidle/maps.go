package pokeidle

import (
	"sort"
	"strings"
)

type OutlandTier struct {
	Tier  int     `json:"tier"`
	Label string  `json:"rotulo"`
	Level int     `json:"nivel"`
	Mult  float64 `json:"mult"`
}

var DefaultOutlandTiers = []OutlandTier{
	{Tier: 1, Label: "Outland 1", Level: 150, Mult: 1},
	{Tier: 2, Label: "Outland 2", Level: 1000, Mult: 1.25},
	{Tier: 3, Label: "Outland 3", Level: 2000, Mult: 1.5},
	{Tier: 4, Label: "Outland 4", Level: 4000, Mult: 2},
	{Tier: 5, Label: "Outland 5", Level: 8000, Mult: 3},
	{Tier: 6, Label: "Outland 6", Level: 16000, Mult: 4},
	{Tier: 7, Label: "Outland 7", Level: 24000, Mult: 6},
	{Tier: 8, Label: "Outland 8", Level: 36000, Mult: 8},
}

func NormalizeOutlandTiers(raw []any) []OutlandTier {
	var out []OutlandTier
	for _, x := range raw {
		m := asMap(x)
		if m == nil {
			continue
		}
		tier := asInt(m["tier"])
		if tier <= 0 {
			continue
		}
		lbl := asString(m["rotulo"])
		if lbl == "" {
			lbl = "Outland"
		}
		mult := asFloat(m["mult"])
		if mult <= 0 {
			mult = 1
		}
		out = append(out, OutlandTier{
			Tier:  tier,
			Label: lbl,
			Level: asInt(m["nivel"]),
			Mult:  mult,
		})
	}
	if len(out) == 0 {
		return append([]OutlandTier(nil), DefaultOutlandTiers...)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Tier < out[j].Tier })
	return out
}

type genBand struct {
	lo, hi int
	region string
}

var generations = []genBand{
	{1, 151, "kanto"},
	{152, 251, "johto"},
	{252, 386, "hoenn"},
	{387, 493, "sinnoh"},
	{494, 649, "unova"},
	{650, 721, "kalos"},
	{722, 809, "alola"},
	{810, 905, "galar"},
	{906, 1025, "paldea"},
}

func dexOfPokeID(id int) int {
	if id <= 0 {
		return 0
	}
	if id <= 1025 {
		return id
	}
	if id >= 13000 && id < 14000 {
		return id - 13000
	}
	if id >= 2000 && id < 13000 {
		return 0
	}
	return id % 1000
}

func RegionOfHunt(h map[string]any) string {
	if h == nil {
		return "kanto"
	}
	reg := strings.ToLower(strings.TrimSpace(asString(h["regiao"])))
	if reg != "" {
		if strings.HasPrefix(reg, "outland") {
			return "outland"
		}
		return reg
	}
	area := strings.ToLower(strings.TrimSpace(asString(h["area"])))
	if strings.HasPrefix(area, "outland") {
		return "outland"
	}
	weights := map[string]int{}
	for _, raw := range asSlice(h["especies"]) {
		e := asMap(raw)
		if e == nil {
			continue
		}
		dex := dexOfPokeID(asInt(e["pokeId"]))
		if dex <= 0 {
			continue
		}
		pts := asInt(e["pontos"])
		if pts <= 0 {
			pts = 1
		}
		for _, g := range generations {
			if dex >= g.lo && dex <= g.hi {
				weights[g.region] += pts
				break
			}
		}
	}
	bestReg := ""
	bestW := -1
	for r, w := range weights {
		if w > bestW {
			bestW = w
			bestReg = r
		}
	}
	if bestReg != "" {
		return bestReg
	}
	if area != "" {
		return area
	}
	return "kanto"
}

type HuntSpeciesInfo struct {
	PokeID   int      `json:"pokeId"`
	Name     string   `json:"nome"`
	Looktype int      `json:"looktype"`
	Types    []string `json:"tipos"`
	Points   int      `json:"pontos"`
	MinLevel int      `json:"nivelMin"`
	MaxLevel int      `json:"nivelMax"`
}

type HuntInfo struct {
	Slug        string            `json:"slug"`
	Name        string            `json:"nome"`
	Region      string            `json:"regiao"`
	Area        string            `json:"area"`
	MinLevel    int               `json:"nivelMin"`
	MaxLevel    int               `json:"nivelMax"`
	RequiredLv  int               `json:"nivelNecessario"`
	Types       []string          `json:"tipos"`
	Species     []HuntSpeciesInfo `json:"especies"`
	Drops       []string          `json:"drops"`
	MainLook    int               `json:"mainLook"`
	IsOutland   bool              `json:"isOutland"`
}

type HuntsCatalog struct {
	AccountID    int           `json:"accountId"`
	AccountLevel int           `json:"accountLevel"`
	ActiveSlug   string        `json:"activeSlug"`
	PendingSlug  string        `json:"pendingSlug"`
	CombatLockMs int64         `json:"combatLockMs"`
	OutlandTier  int           `json:"outlandTier"`
	OutlandTiers []OutlandTier `json:"outlandTiers"`
	Hunts        []HuntInfo    `json:"hunts"`
}

func BuildHuntInfoList(rawHunts []any) []HuntInfo {
	out := make([]HuntInfo, 0, len(rawHunts))
	for _, r := range rawHunts {
		h := asMap(r)
		if h == nil {
			continue
		}
		slug := asString(h["slug"])
		if slug == "" {
			continue
		}
		reg := RegionOfHunt(h)
		typeSet := map[string]bool{}
		species := []HuntSpeciesInfo{}
		bestPts := -1
		mainLook := 0
		for _, er := range asSlice(h["especies"]) {
			em := asMap(er)
			if em == nil {
				continue
			}
			tipos := []string{}
			for _, tr := range asSlice(em["tipos"]) {
				if ts := strings.ToUpper(asString(tr)); ts != "" {
					tipos = append(tipos, ts)
					typeSet[ts] = true
				}
			}
			if t1 := strings.ToUpper(asString(em["tipo1"])); t1 != "" && len(tipos) == 0 {
				tipos = append(tipos, t1)
				typeSet[t1] = true
				if t2 := strings.ToUpper(asString(em["tipo2"])); t2 != "" {
					tipos = append(tipos, t2)
					typeSet[t2] = true
				}
			}
			pts := asInt(em["pontos"])
			lt := asInt(em["looktype"])
			if pts > bestPts && lt > 0 {
				bestPts = pts
				mainLook = lt
			}
			species = append(species, HuntSpeciesInfo{
				PokeID:   asInt(em["pokeId"]),
				Name:     asString(em["nome"]),
				Looktype: lt,
				Types:    tipos,
				Points:   pts,
				MinLevel: asInt(em["nivelMin"]),
				MaxLevel: asInt(em["nivelMax"]),
			})
		}
		if mainLook == 0 {
			mainLook = asInt(h["looktype"])
		}
		for _, tr := range asSlice(h["tipos"]) {
			if ts := strings.ToUpper(asString(tr)); ts != "" {
				typeSet[ts] = true
			}
		}
		tipos := make([]string, 0, len(typeSet))
		for t := range typeSet {
			tipos = append(tipos, t)
		}
		sort.Strings(tipos)

		drops := []string{}
		for _, dr := range asSlice(h["drops"]) {
			if dm := asMap(dr); dm != nil {
				if n := asString(dm["nome"]); n != "" {
					drops = append(drops, n)
				}
			} else if ds := asString(dr); ds != "" {
				drops = append(drops, ds)
			}
		}

		reqLv := asInt(h["nivelNecessario"])
		if reqLv == 0 {
			reqLv = asInt(h["nivelMin"])
		}
		if reqLv == 0 {
			reqLv = asInt(h["nivel"])
		}
		out = append(out, HuntInfo{
			Slug:       slug,
			Name:       asString(h["nome"]),
			Region:     reg,
			Area:       asString(h["area"]),
			MinLevel:   asInt(h["nivelMin"]),
			MaxLevel:   asInt(h["nivelMax"]),
			RequiredLv: reqLv,
			Types:      tipos,
			Species:    species,
			Drops:      drops,
			MainLook:   mainLook,
			IsOutland:  reg == "outland",
		})
	}
	return out
}
