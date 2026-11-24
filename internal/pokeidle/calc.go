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
	ID          int                `json:"id"`
	AccountID   int                `json:"accountId"`
	AccountNick string             `json:"accountNick"`
	PokeID      int                `json:"pokeId"`
	Name        string             `json:"nome"`
	Nickname    string             `json:"apelido"`
	Species     string             `json:"especie"`
	Level       int                `json:"level"`
	HP          int                `json:"hp"`
	MaxHP       int                `json:"maxHp"`
	XP          int64              `json:"xp"`
	XPNext      int64              `json:"xpProximo"`
	Shiny       bool               `json:"shiny"`
	Looktype    int                `json:"looktype"`
	InTeam      bool               `json:"noTime"`
	Active      bool               `json:"ativo"`
	Locked      bool               `json:"trancado"`
	Quality     float64            `json:"qualidade"`
	Potency     int                `json:"potencia"`
	HeldItemID  int                `json:"heldItemId"`
	IVs         map[string]int     `json:"ivs"`
	IVSum       int                `json:"ivSoma"`
	IVPct       float64            `json:"ivPct"`
	Stats       map[string]int     `json:"stats"`
	Types       []string           `json:"tipos"`
	Grade       float64            `json:"nota"`
	GradeTier   string             `json:"faixa"`
	MarketOK    bool               `json:"mercadoOk"`
	GradeAxes   map[string]float64 `json:"eixos"`
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
	loIV := map[string]int{"hp": 1, "atk": 1, "def": 1, "spAtk": 1, "spDef": 1, "speed": 1}
	hiIV := map[string]int{"hp": 32, "atk": 32, "def": 32, "spAtk": 32, "spDef": 32, "speed": 32}

	lo := birthSum(loIV, 0.8, 1, false, nil)
	hi := birthSum(hiIV, 1.8, 5, true, nil)
	cur := clampF(birthSum(ivs, quality, potency, shiny, nil), lo, hi)

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
		"iv":        gain(birthSum(loIV, quality, potency, shiny, nil)),
		"qualidade": gain(birthSum(ivs, 0.8, potency, shiny, nil)),
		"potencia":  gain(birthSum(ivs, quality, 1, shiny, nil)),
		"shiny":     gain(birthSum(ivs, quality, potency, false, nil)),
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
	grade, tier, axes := ComputeBirthGrade(ivs, quality, potency, shiny)

	tipos := []string{}
	for _, tr := range asSlice(pk["tipos"]) {
		if s := asString(tr); s != "" {
			tipos = append(tipos, s)
		}
	}

	id := asInt(pk["id"])
	name := asString(pk["nome"])
	if name == "" {
		name = asString(pk["especie"])
	}
	return PokemonDetail{
		ID:          id,
		AccountID:   accID,
		AccountNick: accNick,
		PokeID:      asInt(pk["pokeId"]),
		Name:        name,
		Nickname:    asString(pk["apelido"]),
		Species:     asString(pk["especie"]),
		Level:       asInt(pk["level"]),
		HP:          asInt(pk["hp"]),
		MaxHP:       asInt(pk["maxHp"]),
		XP:          asInt64(pk["xp"]),
		XPNext:      asInt64(pk["xpProximo"]),
		Shiny:       shiny,
		Looktype:    lookOf(pk),
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
		Types:       tipos,
		Grade:       grade,
		GradeTier:   tier,
		MarketOK:    shiny || potency >= 5 || grade >= 3.5,
		GradeAxes:   axes,
	}
}

func SortPokemons(list []PokemonDetail, sortBy string) {
	sort.Slice(list, func(i, j int) bool {
		switch sortBy {
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
