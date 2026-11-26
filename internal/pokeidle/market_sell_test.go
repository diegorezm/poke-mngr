package pokeidle

import (
	"testing"

	"poke-mngr/internal/config"
	"poke-mngr/internal/store"
)

func TestExtractValidFloorIgnoresOwnAndSpoof(t *testing.T) {
	listings := []any{
		map[string]any{"id": 1, "preco": 100, "vendedor": "TrollSpoof", "estado": "aberto"},    // <50% of 1000 avg -> spoof
		map[string]any{"id": 2, "preco": 850, "vendedor": "MyAccount", "estado": "aberto"},     // own account -> ignored
		map[string]any{"id": 3, "preco": 900, "vendedor": "RivalA", "estado": "encerrado"},     // closed -> ignored
		map[string]any{"id": 4, "preco": 980, "vendedor": "RivalB", "estado": "aberto"},        // valid lowest
		map[string]any{"id": 5, "preco": 1100, "vendedor": "RivalC", "estado": "aberto"},       // valid higher
	}
	own := map[string]bool{"myaccount": true}
	floor, count := ExtractValidFloor(listings, own, 1000)
	if floor != 980 || count != 2 {
		t.Fatalf("expected floor=980 count=2, got floor=%d count=%d", floor, count)
	}
}

func TestComputeSellPriceSmartAndUndercut(t *testing.T) {
	// Smart mode above avg floor -> undercuts competitor by 1
	smartSpec := store.MarketSellRuleSpec{
		Target:           "item",
		Moeda:            "gold",
		PriceMode:        "smart",
		MinPrice:         700,
		MinPctOfAvg:      85,
		UndercutStep:     1,
		BelowFloorAction: "hold",
	}
	dec := ComputeSellPrice(smartSpec, 1000, 1000, 2)
	if !dec.ShouldList || dec.Price != 999 || dec.HardFloor != 850 {
		t.Fatalf("expected smart list @ 999 (hardFloor 850), got %+v", dec)
	}

	// Smart mode when competitor drops below 85% avg -> holds
	decHold := ComputeSellPrice(smartSpec, 800, 1000, 2)
	if decHold.ShouldList {
		t.Fatalf("expected smart hold when floor=800 < hardFloor=850, got %+v", decHold)
	}

	// Smart mode with list_at_floor -> lists at hardFloor (850)
	smartSpec.BelowFloorAction = "list_at_floor"
	decFloor := ComputeSellPrice(smartSpec, 800, 1000, 2)
	if !decFloor.ShouldList || decFloor.Price != 850 {
		t.Fatalf("expected smart list at floor 850, got %+v", decFloor)
	}

	// Undercut mode with % step and hard floor
	undercutSpec := store.MarketSellRuleSpec{
		Target:           "item",
		Moeda:            "gold",
		PriceMode:        "undercut",
		MinPrice:         500,
		UndercutPct:      2,
		BelowFloorAction: "hold",
	}
	decU := ComputeSellPrice(undercutSpec, 1000, 0, 2)
	if !decU.ShouldList || decU.Price != 980 {
		t.Fatalf("expected undercut 2%% -> 980, got %+v", decU)
	}
	decUBelow := ComputeSellPrice(undercutSpec, 480, 0, 2)
	if decUBelow.ShouldList {
		t.Fatalf("expected undercut hold below minPrice 500, got %+v", decUBelow)
	}
}

func TestSelectExcessPokemonsSafetyAndKeepBest(t *testing.T) {
	pks := []PokemonDetail{
		{ID: 1, Name: "Gengar", Level: 80, Grade: 7.5, IVSum: 170, InTeam: true},          // best #1 (in team)
		{ID: 2, Name: "Gengar", Level: 70, Grade: 6.0, IVSum: 150, Locked: true},          // protected (locked)
		{ID: 3, Name: "Gengar", Level: 60, Grade: 5.5, IVSum: 140, HeldItemID: 204},       // protected (held item)
		{ID: 4, Name: "Gengar", Level: 60, Grade: 5.2, IVSum: 135, Shiny: true},           // blocked by shinyMode=no
		{ID: 5, Name: "Gengar", Level: 60, Grade: 5.0, IVSum: 130, Potency: 5},            // blocked by allowP5=false
		{ID: 6, Name: "Gengar", Level: 40, Grade: 5.0, IVSum: 130},                        // ineligible (level < 50)
		{ID: 7, Name: "Gengar", Level: 55, Grade: 4.5, IVSum: 120},                        // ELIGIBLE!
		{ID: 8, Name: "Gengar", Level: 55, Grade: 4.8, IVSum: 125},                        // protected via skin in raw
	}
	raw := map[int]map[string]any{
		8: {"id": 8, "skin": "halloween"},
	}

	spec := store.MarketSellRuleSpec{
		Target:        "pokemon",
		Moeda:         "gold",
		Query:         "gengar",
		KeepBestCount: 1,
		ShinyMode:     "no",
		AllowP5:       false,
		MaxGrade:      6.5,
	}
	got := SelectExcessPokemons(pks, raw, spec)
	if len(got) != 1 || got[0].ID != 7 {
		t.Fatalf("expected only pokemon #7 to be selected, got %+v", got)
	}
}

func TestHasRestockConflict(t *testing.T) {
	opts := config.DefaultAccountOptions()
	opts.Restock = config.RestockConfig{
		Enabled: true,
		Potion:  config.RestockRule{Enabled: true, ID: 204, Below: 20, Keep: 150},
	}
	if conflict, _ := HasRestockConflict(opts, 204, 100, nil); !conflict {
		t.Fatalf("expected conflict when keepQty=100 <= restock.Keep=150")
	}
	if conflict, _ := HasRestockConflict(opts, 204, 200, nil); conflict {
		t.Fatalf("expected no conflict when keepQty=200 > restock.Keep=150")
	}
}

func TestShouldRepriceListingCooldownAndDiff(t *testing.T) {
	now := int64(1_700_000_000_000)

	// In edit cooldown -> must skip
	adCooling := map[string]any{"id": 10, "estado": "aberto", "preco": 1000, "editavelEm": now + 60_000}
	if ok, _ := ShouldRepriceListing(adCooling, 800, 3, now); ok {
		t.Fatalf("expected skip during editavelEm cooldown")
	}

	// In retention window -> must skip
	adRetained := map[string]any{"id": 11, "estado": "aberto", "preco": 1000, "compravelEm": now + 30_000}
	if ok, _ := ShouldRepriceListing(adRetained, 800, 3, now); ok {
		t.Fatalf("expected skip during compravelEm retention")
	}

	// Diff < 3% -> must skip
	adSmallDiff := map[string]any{"id": 12, "estado": "aberto", "preco": 1000}
	if ok, _ := ShouldRepriceListing(adSmallDiff, 985, 3, now); ok {
		t.Fatalf("expected skip when diff 1.5%% < 3%%")
	}

	// Diff >= 3% -> should reprice
	if ok, _ := ShouldRepriceListing(adSmallDiff, 950, 3, now); !ok {
		t.Fatalf("expected reprice when diff 5%% >= 3%%")
	}
}

func TestComputeSellableItemExcessWithBoundUnits(t *testing.T) {
	// 50 total, 10 bound (bought from market), keep 20 -> 10 bound count toward keep, 30 free sellable
	excess, free := ComputeSellableItemExcess(50, 10, 20)
	if excess != 30 || free != 40 {
		t.Fatalf("expected excess=30 free=40, got excess=%d free=%d", excess, free)
	}
	// 50 total, 45 bound, keep 20 -> overKeep=30, but only 5 free -> excess=5
	excess2, free2 := ComputeSellableItemExcess(50, 45, 20)
	if excess2 != 5 || free2 != 5 {
		t.Fatalf("expected excess=5 free=5, got excess=%d free=%d", excess2, free2)
	}
	// All bound -> 0 sellable
	excess3, free3 := ComputeSellableItemExcess(30, 30, 10)
	if excess3 != 0 || free3 != 0 {
		t.Fatalf("expected excess=0 free=0, got excess=%d free=%d", excess3, free3)
	}
}
