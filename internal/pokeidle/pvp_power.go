package pokeidle

import (
	"math"
	"sort"
	"strings"
)

// Exact combat & arena power constants ported from pokeidle-manager-online (pvp_power.py / pokemon_calc.py).
const (
	arenaFullLevel = 150
	arenaExpo      = 0.45
	powerScale     = 1e7
	combatHPMult   = 12
	tmPowerPvE     = 2800
	tmPowerPvP     = 1800
	tmCooldownMs   = 60000
)

var pvpPotencyBonus = []float64{0, 0.05, 0.1, 0.25, 1.0}

var pvpQualityExpo = map[string]float64{
	"hp":    0.95,
	"atk":   0.8,
	"def":   0.8,
	"spAtk": 0.8,
	"spDef": 0.8,
	"speed": 0.95,
}

type EvoBranch struct {
	PokeID int
	Level  int
}

// BranchedEvolutions ported verbatim from evolucoes_ramificadas.py (EVOLUCOES_RAMIFICADAS).
var BranchedEvolutions = map[int][]EvoBranch{
	25:    {{26, 80}, {4026, 43}},
	44:    {{45, 70}, {182, 50}},
	61:    {{62, 80}, {186, 70}},
	79:    {{80, 60}, {199, 1}},
	102:   {{103, 100}, {4103, 34}},
	104:   {{105, 50}, {4105, 34}},
	109:   {{110, 60}, {5110, 69}},
	123:   {{212, 80}, {900, 27}},
	133:   {{134, 80}, {135, 80}, {136, 80}, {196, 80}, {197, 80}, {470, 80}, {471, 80}, {700, 80}},
	156:   {{157, 80}, {6157, 86}},
	217:   {{901, 46}, {8901, 160}},
	236:   {{237, 60}, {106, 60}, {107, 60}},
	265:   {{266, 650}, {268, 500}},
	281:   {{282, 100}, {475, 1}},
	290:   {{291, 700}, {292, 500}},
	361:   {{362, 80}, {478, 1}},
	366:   {{367, 700}, {368, 550}},
	412:   {{413, 2}, {414, 1}, {8413, 2}, {9413, 2}},
	439:   {{122, 80}, {5122, 64}},
	502:   {{503, 100}, {6503, 86}},
	548:   {{549, 100}, {6549, 69}},
	550:   {{902, 69}, {8902, 69}},
	627:   {{628, 100}, {6628, 69}},
	646:   {{8646, 8}, {9646, 8}},
	680:   {{681, 16}, {8681, 21}},
	704:   {{705, 40}, {6705, 64}},
	712:   {{713, 100}, {6713, 69}},
	723:   {{724, 100}, {6724, 86}},
	744:   {{745, 34}, {8745, 34}, {9745, 34}},
	790:   {{791, 7}, {792, 7}},
	840:   {{841, 30}, {842, 26}, {1011, 40}},
	898:   {{8898, 64}, {9898, 64}},
	935:   {{936, 120}, {937, 120}},
	1017:  {{9017, 160}, {8017, 160}, {12017, 160}},
	5079:  {{5080, 69}, {5199, 69}},
	13265: {{266, 650}, {268, 500}},
	13281: {{282, 100}, {475, 1}},
	13290: {{291, 700}, {292, 500}},
	13361: {{362, 80}, {478, 1}},
	13366: {{367, 700}, {368, 550}},
}

type EvoStep struct {
	PokeID   int    `json:"pokeId"`
	Name     string `json:"nome"`
	Looktype int    `json:"looktype"`
	Level    int    `json:"level"`
}

type EvolutionProjection struct {
	PokeID    int     `json:"pokeId"`
	Name      string  `json:"nome"`
	Looktype  int     `json:"looktype"`
	Grade     float64 `json:"nota"`
	GradeTier string  `json:"faixa"`
	MarketOK  bool    `json:"mercadoOk"`
	PvpPower  int     `json:"pvpPower"`
	Range     int     `json:"alcance"`
}

// ArenaLevel computes the flattened PvP/Gym arena level: 150 * (lv / 150)^0.45 for lv > 150.
func ArenaLevel(level int) int {
	if level < 1 {
		level = 1
	}
	if level <= arenaFullLevel {
		return level
	}
	v := int(jsRound(float64(arenaFullLevel) * math.Pow(float64(level)/float64(arenaFullLevel), arenaExpo)))
	if v < arenaFullLevel {
		return arenaFullLevel
	}
	return v
}

func pvpPotencyMult(pot int) float64 {
	idx := pot - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(pvpPotencyBonus) {
		return 1.0
	}
	return 1.0 + pvpPotencyBonus[idx]
}

// CombatHP returns the battle HP displayed on the Pokémon sheet.
func CombatHP(stats map[string]int) int {
	hp := int(jsRound(float64(stats["hp"]) * combatHPMult))
	if hp < 24 {
		return 24
	}
	return hp
}

// SpeciesRange returns board range (1 = melee; 2..4 = ranged based on baseSpAtk excess).
func SpeciesRange(sp *CreatureMeta) int {
	if sp == nil {
		return 1
	}
	maxPhys := sp.BaseAtk
	if sp.BaseHP > maxPhys {
		maxPhys = sp.BaseHP
	}
	gap := float64(sp.BaseSpAtk - maxPhys)
	if gap <= 0 {
		return 1
	}
	if gap < 25 {
		return 2
	}
	if gap < 50 {
		return 3
	}
	return 4
}

func speciesBasesMap(sp *CreatureMeta, refino map[string]any) map[string]float64 {
	b := map[string]float64{
		"hp":    float64(sp.BaseHP),
		"atk":   float64(sp.BaseAtk),
		"def":   float64(sp.BaseDef),
		"spAtk": float64(sp.BaseSpAtk),
		"spDef": float64(sp.BaseSpDef),
		"speed": float64(sp.BaseSpeed),
	}
	if refino != nil {
		for _, k := range []string{"hp", "atk", "def", "spAtk", "spDef"} {
			if r := asInt(refino[k]); r > 0 {
				b[k] += float64(r)
			}
		}
	}
	return b
}

func deduceBirthFactors(pk map[string]any, sp *CreatureMeta) map[string]float64 {
	b := speciesBasesMap(sp, asMap(pk["refino"]))
	ivs := asMap(pk["ivs"])
	stats := asMap(pk["stats"])
	lv := asInt(pk["level"])
	if lv < 1 {
		lv = 1
	}
	q := asFloat(pk["quality"])
	if q == 0 {
		q = asFloat(pk["qualidade"])
	}
	if q == 0 {
		q = 1.0
	}
	pot := asInt(pk["potencia"])
	if pot < 1 {
		pot = 1
	}
	shinyMult := 1.0
	if asBool(pk["shiny"]) {
		shinyMult = 3.0
	}

	out := make(map[string]float64, len(statKeys))
	for _, k := range statKeys {
		iv := asFloat(ivs[k])
		if iv < 1 {
			iv = 1
		}
		raw := (b[k] + 2*iv) * float64(lv) / 100.0
		exact := math.Pow(q, pvpQualityExpo[k]) * pvpPotencyMult(pot) * shinyMult
		cur := asFloat(stats[k])
		if cur > 0 && raw > 0 {
			if math.Abs(raw*exact-cur) <= 1.0 {
				out[k] = exact
			} else {
				out[k] = cur / raw
			}
		} else {
			out[k] = exact
		}
	}
	return out
}

func statsAtLevel(pk map[string]any, sp *CreatureMeta, level int) map[string]int {
	b := speciesBasesMap(sp, asMap(pk["refino"]))
	ivs := asMap(pk["ivs"])
	factors := deduceBirthFactors(pk, sp)
	out := make(map[string]int, len(statKeys))
	for _, k := range statKeys {
		iv := asFloat(ivs[k])
		if iv < 1 {
			iv = 1
		}
		out[k] = int(jsRound((b[k] + 2*iv) * (float64(level) / 100.0) * factors[k]))
	}
	return out
}

func moveScore(m CreatureAttack, level int, st map[string]int, types []string) float64 {
	atk := float64(st["atk"])
	dfn := float64(st["def"])
	if m.Category == "SPECIAL" {
		atk = float64(st["spAtk"])
		dfn = float64(st["spDef"])
	}
	if dfn < 1 {
		dfn = 1
	}
	stab := 1.0
	for _, t := range types {
		if strings.EqualFold(t, m.Type) {
			stab = 1.5
			break
		}
	}
	return (((2.0*float64(level))/5.0+2.0)*float64(m.Power)*(atk/dfn)/50.0 + 2.0) * stab
}

func bestMoveFor(sp *CreatureMeta, level int, st map[string]int, pk map[string]any, pvp bool) CreatureAttack {
	basic := CreatureAttack{Name: "Basic", Power: 30, CooldownMs: 2000, Category: "PHYSICAL"}
	var moves []CreatureAttack
	for _, a := range sp.Attacks {
		if a.LearnLevel <= level {
			moves = append(moves, a)
		}
	}
	if tm := strings.ToUpper(strings.TrimSpace(asString(pk["tmElemental"]))); tm != "" {
		cat := "SPECIAL"
		if asBool(pk["tmFisico"]) {
			cat = "PHYSICAL"
		}
		pwr := tmPowerPvE
		if pvp {
			pwr = tmPowerPvP
		}
		moves = append(moves, CreatureAttack{
			Name:       "Z-Move " + tm,
			Type:       tm,
			Category:   cat,
			Power:      pwr,
			CooldownMs: tmCooldownMs,
			LearnLevel: 1,
		})
	}
	if len(moves) == 0 {
		return basic
	}
	best := basic
	bestScore := -1.0
	for _, m := range moves {
		sc := moveScore(m, level, st, sp.Types)
		if sc > bestScore {
			bestScore = sc
			best = m
		}
	}
	return best
}

func combatRating(pk map[string]any, sp *CreatureMeta, level int, pvp bool) float64 {
	st := statsAtLevel(pk, sp, level)
	m := bestMoveFor(sp, level, st, pk, pvp)
	atk := float64(st["atk"])
	if float64(st["spAtk"]) > atk {
		atk = float64(st["spAtk"])
	}
	dfn := (float64(st["def"]) + float64(st["spDef"])) / 2.0
	pwr := m.Power
	if pwr <= 0 {
		pwr = 30
	}
	cd := m.CooldownMs
	if cd < 400 {
		cd = 400
	}
	dps := (((2.0*float64(level))/5.0 + 2.0) * float64(pwr) * atk) / 50.0 / (float64(cd) / 1000.0)
	hp := float64(CombatHP(st))
	return dps * hp * dfn
}

// PvpPower computes the Pokémon's arena combat power using the flattened arena level.
func PvpPower(pk map[string]any, sp *CreatureMeta) int {
	if sp == nil || (sp.BaseHP == 0 && sp.BaseAtk == 0 && sp.BaseSpAtk == 0) {
		return 0
	}
	lv := ArenaLevel(asInt(pk["level"]))
	v := int(jsRound(combatRating(pk, sp, lv, true) / powerScale))
	if v < 1 {
		return 1
	}
	return v
}

// PvePower computes the Pokémon's real-level combat power (without arena flattening).
func PvePower(pk map[string]any, sp *CreatureMeta) int {
	if sp == nil || (sp.BaseHP == 0 && sp.BaseAtk == 0 && sp.BaseSpAtk == 0) {
		return 0
	}
	lv := asInt(pk["level"])
	if lv < 1 {
		lv = 1
	}
	v := int(jsRound(combatRating(pk, sp, lv, false) / powerScale))
	if v < 1 {
		return 1
	}
	return v
}

func hasPlayableArt(sp CreatureMeta) bool {
	if sp.Looktype <= 1 {
		return false
	}
	if (sp.PokeID >= 3000 && sp.PokeID < 4000) || sp.PokeID >= 13000 {
		return true
	}
	return !(sp.PokeID >= 1000 && sp.PokeID < 13000 && sp.Looktype != 60000+sp.PokeID)
}

func evolutionTargets(sp CreatureMeta, all map[int]CreatureMeta) []EvoStep {
	var out []EvoStep
	seen := map[int]bool{}
	add := func(pid, lv int) {
		if pid <= 0 || seen[pid] {
			return
		}
		target, ok := all[pid]
		if !ok {
			return
		}
		seen[pid] = true
		out = append(out, EvoStep{
			PokeID:   target.PokeID,
			Name:     target.Name,
			Looktype: target.Looktype,
			Level:    lv,
		})
	}
	for _, br := range BranchedEvolutions[sp.PokeID] {
		add(br.PokeID, br.Level)
	}
	if sp.EvolvesToID > 0 {
		add(sp.EvolvesToID, sp.EvolveLevel)
	}
	return out
}

// DirectEvolutions returns immediate pre-evolution (if any) and immediate next evolutions (including branches).
func DirectEvolutions(sp CreatureMeta, all map[int]CreatureMeta) (*EvoStep, []EvoStep) {
	if len(all) == 0 {
		return nil, nil
	}
	next := evolutionTargets(sp, all)
	var prev *EvoStep
	for _, cand := range all {
		for _, t := range evolutionTargets(cand, all) {
			if t.PokeID == sp.PokeID {
				prev = &EvoStep{
					PokeID:   cand.PokeID,
					Name:     cand.Name,
					Looktype: cand.Looktype,
					Level:    t.Level,
				}
				break
			}
		}
		if prev != nil {
			break
		}
	}
	return prev, next
}

// FinalEvolutionProjections resolves all terminal evolutions (including branched paths like Eevee, Tyrogue, Slowpoke)
// and projects Birth Grade, PvP Power, and board range for each target species.
func FinalEvolutionProjections(pk map[string]any, sp CreatureMeta, all map[int]CreatureMeta, ivs map[string]int, quality float64, potency int, shiny bool) []EvolutionProjection {
	if len(all) == 0 {
		return nil
	}
	finals := map[int]CreatureMeta{}
	var dfs func(cur CreatureMeta, isRoot bool, visited map[int]bool)
	dfs = func(cur CreatureMeta, isRoot bool, visited map[int]bool) {
		var nextList []CreatureMeta
		for _, t := range evolutionTargets(cur, all) {
			if visited[t.PokeID] {
				continue
			}
			if target, ok := all[t.PokeID]; ok && hasPlayableArt(target) {
				nextList = append(nextList, target)
			}
		}
		if len(nextList) == 0 {
			if !isRoot {
				finals[cur.PokeID] = cur
			}
			return
		}
		nextVisited := make(map[int]bool, len(visited)+1)
		for k, v := range visited {
			nextVisited[k] = v
		}
		nextVisited[cur.PokeID] = true
		for _, nxt := range nextList {
			dfs(nxt, false, nextVisited)
		}
	}
	dfs(sp, true, map[int]bool{})
	if len(finals) == 0 {
		return nil
	}

	out := make([]EvolutionProjection, 0, len(finals))
	for _, target := range finals {
		tCopy := target
		bases := speciesBasesMap(&tCopy, asMap(pk["refino"]))
		grade, tier, _ := ComputeBirthGradeWithBases(ivs, quality, potency, shiny, bases)
		out = append(out, EvolutionProjection{
			PokeID:    tCopy.PokeID,
			Name:      tCopy.Name,
			Looktype:  tCopy.Looktype,
			Grade:     grade,
			GradeTier: tier,
			MarketOK:  shiny || potency >= 5 || grade >= 3.5,
			PvpPower:  PvpPower(pk, &tCopy),
			Range:     SpeciesRange(&tCopy),
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].PvpPower != out[j].PvpPower {
			return out[i].PvpPower > out[j].PvpPower
		}
		return out[i].Name < out[j].Name
	})
	return out
}
