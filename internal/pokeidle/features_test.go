package pokeidle

import (
	"testing"
)

func TestComputeBirthGradeAndRegions(t *testing.T) {
	low, lowTier, _ := ComputeBirthGrade(map[string]int{"hp": 1, "atk": 1, "def": 1, "spAtk": 1, "spDef": 1, "speed": 1}, 0.8, 1, false)
	high, highTier, _ := ComputeBirthGrade(map[string]int{"hp": 32, "atk": 32, "def": 32, "spAtk": 32, "spDef": 32, "speed": 32}, 1.8, 5, true)
	if low != 0 || lowTier != "extremamente-fraco" {
		t.Fatalf("expected 0/extremamente-fraco, got %v/%s", low, lowTier)
	}
	if high != 10 || highTier != "divino" {
		t.Fatalf("expected 10/divino, got %v/%s", high, highTier)
	}

	if r := RegionOfHunt(map[string]any{"area": "Outland Fire"}); r != "outland" {
		t.Fatalf("expected outland, got %s", r)
	}
	if r := RegionOfHunt(map[string]any{"especies": []any{map[string]any{"pokeId": float64(25), "pontos": float64(10)}}}); r != "kanto" {
		t.Fatalf("expected kanto, got %s", r)
	}
}

func TestChatHubDedupeAndNormalize(t *testing.T) {
	hub := NewChatHub()
	frame := map[string]any{
		"t":      "chat",
		"id":     float64(42),
		"canal":  "mundo",
		"idioma": "pt",
		"de":     "Ash",
		"nivel":  float64(50),
		"texto":  "Oi pessoal!",
	}
	hub.HandleFrame(1, "Ash", frame)
	hub.HandleFrame(2, "Misty", frame) // duplicate from 2nd account
	msgs := hub.Messages("mundo")
	if len(msgs) != 1 || msgs[0].Text != "Oi pessoal!" {
		t.Fatalf("expected 1 deduped message, got %+v", msgs)
	}
}
