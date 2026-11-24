package pokeidle

import (
	"testing"

	"poke-mngr/internal/store"
)

func TestArenaLevelFlattening(t *testing.T) {
	if got := ArenaLevel(100); got != 100 {
		t.Fatalf("expected 100, got %d", got)
	}
	if got := ArenaLevel(150); got != 150 {
		t.Fatalf("expected 150, got %d", got)
	}
	// Reference example from pvp_power.py docstring: level 2064 -> ~488
	got := ArenaLevel(2064)
	if got < 485 || got > 492 {
		t.Fatalf("expected ~488 for level 2064, got %d", got)
	}
}

func TestSpeciesRangeAndPowers(t *testing.T) {
	melee := &CreatureMeta{PokeID: 68, Name: "Machamp", BaseHP: 90, BaseAtk: 130, BaseDef: 80, BaseSpAtk: 65, BaseSpDef: 85, BaseSpeed: 55}
	if r := SpeciesRange(melee); r != 1 {
		t.Fatalf("expected range 1 for melee, got %d", r)
	}
	ranged := &CreatureMeta{
		PokeID: 65, Name: "Alakazam", Looktype: 65, Types: []string{"PSYCHIC"},
		BaseHP: 55, BaseAtk: 50, BaseDef: 45, BaseSpAtk: 135, BaseSpDef: 95, BaseSpeed: 120,
		Attacks: []CreatureAttack{
			{Name: "Psychic", Type: "PSYCHIC", Category: "SPECIAL", Power: 90, CooldownMs: 2000, LearnLevel: 30},
		},
	}
	if r := SpeciesRange(ranged); r != 4 {
		t.Fatalf("expected range 4 for Alakazam (gap=80), got %d", r)
	}

	pk := map[string]any{
		"id": 10, "speciesId": 65, "nome": "Alakazam", "level": 500, "quality": 1.4, "potencia": 5, "shiny": true,
		"ivs": map[string]any{"hp": 30, "atk": 15, "def": 25, "spAtk": 32, "spDef": 28, "speed": 31},
	}
	pvp := PvpPower(pk, ranged)
	pve := PvePower(pk, ranged)
	if pvp <= 0 || pve <= 0 {
		t.Fatalf("expected positive powers, got pvp=%d pve=%d", pvp, pve)
	}
	if pve <= pvp {
		t.Fatalf("at level 500, real-level pve (%d) should exceed arena-flattened pvp (%d)", pve, pvp)
	}
}

func TestBranchedEvolutionsEevee(t *testing.T) {
	cc := NewCreatureCatalog()
	cc.byID[133] = CreatureMeta{PokeID: 133, Name: "Eevee", Looktype: 133, BaseHP: 55, BaseAtk: 55, BaseDef: 50, BaseSpAtk: 45, BaseSpDef: 65, BaseSpeed: 55}
	cc.byID[134] = CreatureMeta{PokeID: 134, Name: "Vaporeon", Looktype: 134, BaseHP: 130, BaseAtk: 65, BaseDef: 60, BaseSpAtk: 110, BaseSpDef: 95, BaseSpeed: 65}
	cc.byID[135] = CreatureMeta{PokeID: 135, Name: "Jolteon", Looktype: 135, BaseHP: 65, BaseAtk: 65, BaseDef: 60, BaseSpAtk: 110, BaseSpDef: 95, BaseSpeed: 130}
	cc.byID[196] = CreatureMeta{PokeID: 196, Name: "Espeon", Looktype: 196, BaseHP: 65, BaseAtk: 65, BaseDef: 60, BaseSpAtk: 130, BaseSpDef: 95, BaseSpeed: 110}

	pk := map[string]any{
		"id": 1, "speciesId": 133, "nome": "Eevee", "level": 50, "quality": 1.5, "potencia": 4, "shiny": false,
		"ivs": map[string]any{"hp": 28, "atk": 25, "def": 24, "spAtk": 31, "spDef": 29, "speed": 30},
	}
	det := BuildPokemonDetailWithCatalog(1, "Ash", 1, pk, cc)
	if len(det.Evolutions) != 3 {
		t.Fatalf("expected 3 branched final evolutions loaded in catalog, got %d", len(det.Evolutions))
	}
	if len(det.DirectNext) != 3 {
		t.Fatalf("expected 3 direct next evolutions, got %d", len(det.DirectNext))
	}
}

func TestEffectiveThresholdAndSellPremium(t *testing.T) {
	// Only maxPrice
	if got := EffectiveThreshold(store.MarketRuleSpec{MaxPrice: 10000}, 0); got != 10000 {
		t.Fatalf("expected 10000, got %d", got)
	}
	// Only MaxPctBelow: 20% below 5000 = 4000
	if got := EffectiveThreshold(store.MarketRuleSpec{MaxPctBelow: 20}, 5000); got != 4000 {
		t.Fatalf("expected 4000, got %d", got)
	}
	// Both: min(4500, 4000) = 4000
	if got := EffectiveThreshold(store.MarketRuleSpec{MaxPrice: 4500, MaxPctBelow: 20}, 5000); got != 4000 {
		t.Fatalf("expected 4000, got %d", got)
	}
	// SellPremium: +40% with 5 sold -> ok
	prem, ok := SellPremium(140, 100, 5, 0.30)
	if !ok || prem < 0.39 {
		t.Fatalf("expected sell premium ok (~0.40), got %v %v", prem, ok)
	}
	// Too few sold -> reject
	if _, ok := SellPremium(200, 100, 2, 0.30); ok {
		t.Fatalf("expected reject when sold < 3")
	}
	// Spoof floor (<10% of avg) -> reject
	if _, ok := SellPremium(5, 100, 10, 0.30); ok {
		t.Fatalf("expected reject on spoof price")
	}
}

func TestPublicFichaHubIgnoresDicaAndCaches(t *testing.T) {
	hub := NewPublicFichaHub()
	// Guild war tooltip frame ("dica") should be ignored
	hub.HandleFrame(map[string]any{"t": "ranking.ficha", "dica": true, "pokemon": map[string]any{"id": 99, "nome": "Pikachu"}})
	if _, ok := hub.cache[99]; ok {
		t.Fatalf("dica frame should not be cached")
	}
	// Real ficha frame should be cached and resolve waiters
	ch := make(chan map[string]any, 1)
	hub.waiters[99] = []chan map[string]any{ch}
	hub.HandleFrame(map[string]any{"t": "ranking.ficha", "pokemon": map[string]any{"id": 99, "nome": "Pikachu", "level": 100}})
	select {
	case pk := <-ch:
		if asString(pk["nome"]) != "Pikachu" {
			t.Fatalf("unexpected pk: %+v", pk)
		}
	default:
		t.Fatalf("expected waiter to receive ficha")
	}
}
