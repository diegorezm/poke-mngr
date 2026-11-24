package pokeidle

import (
	"testing"

	"poke-mngr/internal/config"
)

func TestHuntPkMudAndPkFora(t *testing.T) {
	hm := NewHuntManager()
	hm.OnWelcome(map[string]any{
		"huntSlug": "kanto-1",
		"activeId": float64(10),
		"pokemons": []any{
			map[string]any{"id": float64(10), "nome": "Pikachu", "hp": float64(100), "maxHp": float64(100)},
			map[string]any{"id": float64(20), "nome": "Pidgey", "hp": float64(40), "maxHp": float64(40)},
		},
	}, nil)

	hm.HandleEstadoPatch(map[string]any{
		"pkMud": []any{
			map[string]any{"id": float64(10), "hp": float64(75)},
		},
		"pkFora": []any{float64(20)},
	})

	pks := asSlice(hm.Estado["pokemons"])
	if len(pks) != 1 {
		t.Fatalf("expected 1 pokemon after pkFora, got %d", len(pks))
	}
	pk := hm.ActivePokemon()
	if asString(pk["nome"]) != "Pikachu" || asInt(pk["hp"]) != 75 || asInt(pk["maxHp"]) != 100 {
		t.Fatalf("pkMud did not merge cleanly: %+v", pk)
	}
}

func TestShinyTrackerDeduplication(t *testing.T) {
	st := NewShinyTracker(0, 0)
	st.Handle(map[string]any{"k": "morte", "quem": "selvagem", "slot": float64(1), "nome": "Zubat"})
	seen, caught := st.Handle(map[string]any{"k": "bola", "slot": float64(1), "nome": "Zubat", "shiny": true, "sucesso": false})
	if !seen || caught {
		t.Fatalf("expected seen=true caught=false, got %v %v", seen, caught)
	}
	// Matching fugiu right after failed ball must not double-count
	seen2, _ := st.Handle(map[string]any{"k": "fugiu", "slot": float64(1), "nome": "Zubat", "shiny": true})
	if seen2 || st.Seen != 1 {
		t.Fatalf("expected deduped fugiu, got seen2=%v total=%d", seen2, st.Seen)
	}
}

func TestShopRestockGoldFloorAndHysteresis(t *testing.T) {
	sm := NewShopManager()
	cat := NewItemCatalog()
	opts := config.DefaultAccountOptions()
	opts.Restock = config.RestockConfig{
		Enabled:   true,
		GoldFloor: 100_000,
		Potion:    config.RestockRule{Enabled: true, ID: 200, Below: 50, Keep: 200},
		Ball:      config.RestockRule{Enabled: false},
	}

	// Below gold floor -> no buy
	estadoLowGold := map[string]any{"gold": float64(90_000), "items": map[string]any{"200": float64(10)}}
	if order := sm.EvaluateRestock(opts, estadoLowGold, nil, cat); order != nil {
		t.Fatalf("expected nil order below gold floor, got %+v", order)
	}

	// Enough gold, stock 10 < below 50 -> buys 190 to reach Keep=200
	estadoRich := map[string]any{"gold": float64(500_000), "items": map[string]any{"200": float64(10)}}
	order := sm.EvaluateRestock(opts, estadoRich, nil, cat)
	if order == nil || order.ID != 200 || order.Qty != 190 {
		t.Fatalf("expected order id=200 qty=190, got %+v", order)
	}
}

func TestParseImportText(t *testing.T) {
	nick, tok, dev, err := ParseImportText(`{"nick":"Ash","token":"abc123","dispositivo":"dev-xyz"}`)
	if err != nil || nick != "Ash" || tok != "abc123" || dev != "dev-xyz" {
		t.Fatalf("unexpected parse result: %q %q %q err=%v", nick, tok, dev, err)
	}
}
