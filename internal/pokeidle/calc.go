package pokeidle

import (
	"math"
	"sort"
)

var statKeys = []string{"hp", "atk", "def", "spAtk", "spDef", "speed"}

var qualityExpo = map[string]float64{
	"hp":    1.0,
	"atk":   1.0,
	"def":   1.0,
	"spAtk": 1.0,
	"spDef": 1.0,
	"speed": 0.6,
}

var potencyTable = map[int]float64{
	1: 1.0,
	2: 1.15,
	3: 1.35,
	4: 1.65,
	5: 2.0,
}

type GradeTier struct {
	Key string
	Max float64
}

var gradeTiers = []GradeTier{
	{"extremamente-fraco", 1},
	{"fraco", 2},
	{"mediano", 3},
	{"razoavel", 4},
	{"bom", 5},
	{"forte", 6},
	{"poderoso", 7},
	{"mitico", 8},
	{"legendario", 9},
	{"divino", 10},
}

type PokemonDetail struct {
	ID          int                   `json:"id"`
	AccountID   int                   `json:"accountId"`
	AccountNick string                `json:"accountNick"`
	Owner       string                `json:"owner,omitempty"`
	PokeID      int                   `json:"pokeId"`
	Name        string                `json:"nome"`
	Nickname    string                `json:"apelido"`
	Species     string                `json:"especie"`
	Level       int                   `json:"level"`
	HP          int                   `json:"hp"`
	MaxHP       int                   `json:"maxHp"`
	CombatHP    int                   `json:"combatHp"`
	XP          int64                 `json:"xp"`
	XPNext      int64                 `json:"xpProximo"`
	Shiny       bool                  `json:"shiny"`
	Looktype    int                   `json:"looktype"`
	InTeam      bool                  `json:"noTime"`
	Active      bool                  `json:"ativo"`
	Locked      bool                  `json:"trancado"`
	Quality     float64               `json:"qualidade"`
	Potency     int                   `json:"potencia"`
	HeldItemID  int                   `json:"heldItemId"`
	IVs         map[string]int        `json:"ivs"`
	IVSum       int                   `json:"ivSoma"`
	IVPct       float64               `json:"ivPct"`
	Stats       map[string]int        `json:"stats"`
	BaseStats   map[string]int        `json:"baseStats,omitempty"`
	Refino      map[string]int        `json:"refino,omitempty"`
	TmElemental string                `json:"tmElemental,omitempty"`
	TmAoe       bool                  `json:"tmAoe,omitempty"`
	Types       []string              `json:"tipos"`
	Grade       float64               `json:"nota"`
	GradeTier   string                `json:"faixa"`
	MarketOK    bool                  `json:"mercadoOk"`
	GradeAxes   map[string]float64    `json:"eixos"`
	PvpPower    int                   `json:"pvpPower"`
	PvpLevel    int                   `json:"pvpLevel"`
	PvePower    int                   `json:"pvePower"`
	Range       int                   `json:"alcance"`
	DirectPrev  *EvoStep              `json:"evoPrev,omitempty"`
	DirectNext  []EvoStep             `json:"evoNext,omitempty"`
	Evolutions  []EvolutionProjection `json:"evolucoes,omitempty"`
}

func jsRound(v float64) float64 {
	return math.Floor(v + 0.5)
}

func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func potencyMult(p int) float64 {
	if m, ok := potencyTable[p]; ok {
		return m
	}
	return 1.0
}

func birthSum(ivs map[string]int, quality float64, potency int, shiny bool, bases map[string]float64) float64 {
	q := clampF(quality, 0.8, 1.8)
	if q == 0 {
		q = 1.0
	}
	p := int(clampF(float64(potency), 1, 5))
	mult := potencyMult(p)
	if shiny {
		mult *= 3.0
	}
	total := 0.0
	for _, k := range statKeys {
		base := 80.0
		if bases != nil && bases[k] > 0 {
			base = bases[k]
		}
		iv := float64(ivs[k])
		if iv < 1 {
			iv = 1
		}
		total += jsRound((base + 2*iv) * math.Pow(q, qualityExpo[k]) * mult)
	}
	return total
}

func ComputeBirthGrade(ivs map[string]int, quality float64, potency int, shiny bool) (float64, string, map[string]float64) {
	return ComputeBirthGradeWithBases(ivs, quality, potency, shiny, nil)
}

func ComputeBirthGradeWithBases(ivs map[string]int, quality float64, potency int, shiny bool, bases map[string]float64) (float64, string, map[string]float64) {
	loIV := map[string]int{"hp": 1, "atk": 1, "def": 1, "spAtk": 1, "spDef": 1, "speed": 1}
	hiIV := map[string]int{"hp": 32, "atk": 32, "def": 32, "spAtk": 32, "spDef": 32, "speed": 32}

	lo := birthSum(loIV, 0.8, 1, false, bases)
	hi := birthSum(hiIV, 1.8, 5, true, bases)
	cur := clampF(birthSum(ivs, quality, potency, shiny, bases), lo, hi)

	raw := 0.0
	if hi > lo {
		raw = 10.0 * (math.Log(math.Max(1, cur)) - math.Log(lo)) / (math.Log(hi) - math.Log(lo))
	}
	grade := jsRound(clampF(raw, 0, 10)*100) / 100

	tier := "divino"
	for _, gt := range gradeTiers {
		if grade <= gt.Max {
			tier = gt.Key
			break
		}
	}

	logCur := math.Log(math.Max(1, cur))
	gain := func(alt float64) float64 {
		d := logCur - math.Log(math.Max(1, alt))
		if d < 0 {
			return 0
		}
		return d
	}
	axes := map[string]float64{
		"iv":        gain(birthSum(loIV, quality, potency, shiny, bases)),
		"qualidade": gain(birthSum(ivs, 0.8, potency, shiny, bases)),
		"potencia":  gain(birthSum(ivs, quality, 1, shiny, bases)),
		"shiny":     gain(birthSum(ivs, quality, potency, false, bases)),
	}
	sumA := 0.0
	for _, v := range axes {
		sumA += v
	}
	if sumA > 1e-9 {
		for k, v := range axes {
			axes[k] = v / sumA
		}
	}
	return grade, tier, axes
}

func BuildPokemonDetail(accID int, accNick string, activeID int, pk map[string]any) PokemonDetail {
	return BuildPokemonDetailWithCatalog(accID, accNick, activeID, pk, nil)
}

func BuildPokemonDetailWithCatalog(accID int, accNick string, activeID int, pk map[string]any, cc *CreatureCatalog) PokemonDetail {
	ivsRaw := asMap(pk["ivs"])
	ivs := map[string]int{}
	ivSum := 0
	for _, k := range statKeys {
		v := asInt(ivsRaw[k])
		ivs[k] = v
		ivSum += v
	}
	statsRaw := asMap(pk["stats"])
	stats := map[string]int{}
	for _, k := range statKeys {
		stats[k] = asInt(statsRaw[k])
	}
	quality := asFloat(pk["quality"])
	if quality == 0 {
		quality = asFloat(pk["qualidade"])
	}
	if quality == 0 {
		quality = 1.0
	}
	potency := asInt(pk["potencia"])
	if potency <= 0 {
		potency = 1
	}
	shiny := asBool(pk["shiny"])

	var spPtr *CreatureMeta
	var bases map[string]float64
	if cc != nil {
		if sp, ok := cc.FindForPokemon(pk); ok {
			spCopy := sp
			spPtr = &spCopy
			if spCopy.BaseHP > 0 || spCopy.BaseAtk > 0 {
				bases = speciesBasesMap(&spCopy, asMap(pk["refino"]))
			}
		}
	}

	// If the server omitted precomputed stats (e.g., compact market listing), fall back to species base stats
	// so the combat stat chart always reflects the species' real stat distribution.
	hasStats := false
	for _, k := range statKeys {
		if stats[k] > 0 {
			hasStats = true
			break
		}
	}
	if !hasStats && spPtr != nil {
		stats["hp"] = spPtr.BaseHP
		stats["atk"] = spPtr.BaseAtk
		stats["def"] = spPtr.BaseDef
		stats["spAtk"] = spPtr.BaseSpAtk
		stats["spDef"] = spPtr.BaseSpDef
		stats["speed"] = spPtr.BaseSpeed
	}

	var baseStats map[string]int
	if spPtr != nil && (spPtr.BaseHP > 0 || spPtr.BaseAtk > 0) {
		baseStats = map[string]int{
			"hp":    spPtr.BaseHP,
			"atk":   spPtr.BaseAtk,
			"def":   spPtr.BaseDef,
			"spAtk": spPtr.BaseSpAtk,
			"spDef": spPtr.BaseSpDef,
			"speed": spPtr.BaseSpeed,
		}
	}

	var refino map[string]int
	if refRaw := asMap(pk["refino"]); len(refRaw) > 0 {
		for _, k := range statKeys {
			if rv := asInt(refRaw[k]); rv > 0 {
				if refino == nil {
					refino = map[string]int{}
				}
				refino[k] = rv
			}
		}
	}

	grade, tier, axes := ComputeBirthGradeWithBases(ivs, quality, potency, shiny, bases)

	tipos := []string{}
	for _, tr := range asSlice(pk["tipos"]) {
		if s := asString(tr); s != "" {
			tipos = append(tipos, s)
		}
	}
	if len(tipos) == 0 && spPtr != nil && len(spPtr.Types) > 0 {
		tipos = append(tipos, spPtr.Types...)
	}

	id := asInt(pk["id"])
	name := asString(pk["nome"])
	if name == "" {
		name = asString(pk["especie"])
	}
	if name == "" && spPtr != nil {
		name = spPtr.Name
	}
	pokeID := asInt(pk["speciesId"])
	if pokeID == 0 {
		pokeID = asInt(pk["pokeId"])
	}
	if pokeID == 0 && spPtr != nil {
		pokeID = spPtr.PokeID
	}
	look := lookOf(pk)
	if look == 0 && spPtr != nil {
		look = spPtr.Looktype
	}
	level := asInt(pk["level"])
	if level < 1 {
		level = 1
	}

	var pvpPwr, pvePwr int
	var directPrev *EvoStep
	var directNext []EvoStep
	var evolutions []EvolutionProjection
	rng := 1
	if spPtr != nil {
		pvpPwr = PvpPower(pk, spPtr)
		pvePwr = PvePower(pk, spPtr)
		rng = SpeciesRange(spPtr)
		all := cc.All()
		directPrev, directNext = DirectEvolutions(*spPtr, all)
		evolutions = FinalEvolutionProjections(pk, *spPtr, all, ivs, quality, potency, shiny)
	}

	return PokemonDetail{
		ID:          id,
		AccountID:   accID,
		AccountNick: accNick,
		PokeID:      pokeID,
		Name:        name,
		Nickname:    asString(pk["apelido"]),
		Species:     asString(pk["especie"]),
		Level:       level,
		HP:          asInt(pk["hp"]),
		MaxHP:       asInt(pk["maxHp"]),
		CombatHP:    CombatHP(stats),
		XP:          asInt64(pk["xp"]),
		XPNext:      asInt64(pk["xpProximo"]),
		Shiny:       shiny,
		Looktype:    look,
		InTeam:      asBool(pk["noTime"]) || asBool(pk["time"]) || id == activeID,
		Active:      id == activeID,
		Locked:      asBool(pk["trancado"]) || asBool(pk["protegido"]),
		Quality:     quality,
		Potency:     potency,
		HeldItemID:  asInt(pk["heldItemId"]),
		IVs:         ivs,
		IVSum:       ivSum,
		IVPct:       (float64(ivSum) / 192.0) * 100.0,
		Stats:       stats,
		BaseStats:   baseStats,
		Refino:      refino,
		TmElemental: asString(pk["tmElemental"]),
		TmAoe:       asBool(pk["tmAoe"]),
		Types:       tipos,
		Grade:       grade,
		GradeTier:   tier,
		MarketOK:    shiny || potency >= 5 || grade >= 3.5,
		GradeAxes:   axes,
		PvpPower:    pvpPwr,
		PvpLevel:    ArenaLevel(level),
		PvePower:    pvePwr,
		Range:       rng,
		DirectPrev:  directPrev,
		DirectNext:  directNext,
		Evolutions:  evolutions,
	}
}

func SortPokemons(list []PokemonDetail, sortBy string) {
	sort.Slice(list, func(i, j int) bool {
		switch sortBy {
		case "pvp":
			if list[i].PvpPower != list[j].PvpPower {
				return list[i].PvpPower > list[j].PvpPower
			}
		case "pve":
			if list[i].PvePower != list[j].PvePower {
				return list[i].PvePower > list[j].PvePower
			}
		case "nota":
			if list[i].Grade != list[j].Grade {
				return list[i].Grade > list[j].Grade
			}
		case "iv":
			if list[i].IVSum != list[j].IVSum {
				return list[i].IVSum > list[j].IVSum
			}
		case "nome":
			if list[i].Name != list[j].Name {
				return list[i].Name < list[j].Name
			}
		default: // level
			if list[i].Level != list[j].Level {
				return list[i].Level > list[j].Level
			}
		}
		return list[i].ID < list[j].ID
	})
}
