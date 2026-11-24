package pokeidle

import (
	"math"
	"strings"
	"time"
)

var TrackedRares = map[string][]int{
	"boss":       {70000}, // Bronze Boss Token
	"key":        {70011}, // Fragmento de Chave
	"shinyStone": {70012}, // Fragmento de Shiny Stone
	"bike":       {70013}, // Fragmento de Bicicleta
}

var RareLabels = map[string]string{
	"boss":       "Bronze Boss Token",
	"key":        "Fragmento de Chave",
	"shinyStone": "Fragmento de Shiny Stone",
	"bike":       "Fragmento de Bicicleta",
}

type SessionItems struct {
	Gained map[string]int
	last   map[string]int
}

func NewSessionItems(initial map[string]int) *SessionItems {
	g := map[string]int{
		"boss":       0,
		"key":        0,
		"shinyStone": 0,
		"bike":       0,
	}
	for k, v := range initial {
		if _, ok := g[k]; ok && v >= 0 {
			g[k] = v
		}
	}
	return &SessionItems{Gained: g}
}

func countRares(estado map[string]any) map[string]int {
	items := asMap(estado["items"])
	out := make(map[string]int, len(TrackedRares))
	for key, ids := range TrackedRares {
		total := 0
		for _, id := range ids {
			total += mapIntValue(items, id)
		}
		out[key] = total
	}
	return out
}

func (s *SessionItems) ResetBaseline(estado map[string]any) {
	s.last = countRares(estado)
}

// Update computes positive deltas since last state and returns any newly gained items.
func (s *SessionItems) Update(estado map[string]any) map[string]int {
	now := countRares(estado)
	var deltas map[string]int
	if s.last != nil {
		for k, v := range now {
			if diff := v - s.last[k]; diff > 0 {
				s.Gained[k] += diff
				if deltas == nil {
					deltas = map[string]int{}
				}
				deltas[k] = diff
			}
		}
	}
	s.last = now
	return deltas
}

func (s *SessionItems) Clear() {
	for k := range s.Gained {
		s.Gained[k] = 0
	}
}

func (s *SessionItems) Snapshot() map[string]int {
	out := make(map[string]int, len(s.Gained))
	for k, v := range s.Gained {
		out[k] = v
	}
	return out
}

// --- ShinyTracker ---

type shinyEncounter struct {
	name     string
	seen     bool
	captured bool
	failedAt time.Time
	seenAt   time.Time
}

type ShinyTracker struct {
	encounters map[int]*shinyEncounter
	Seen       int
	Captured   int
}

func NewShinyTracker(seen, captured int) *ShinyTracker {
	return &ShinyTracker{
		encounters: map[int]*shinyEncounter{},
		Seen:       seen,
		Captured:   captured,
	}
}

func (t *ShinyTracker) Clear() {
	t.encounters = map[int]*shinyEncounter{}
	t.Seen = 0
	t.Captured = 0
}

func (t *ShinyTracker) Handle(ev map[string]any) (newSeen bool, newCaptured bool) {
	now := time.Now()
	for k, e := range t.encounters {
		if now.Sub(e.seenAt) > 60*time.Second {
			delete(t.encounters, k)
		}
	}
	kind := asString(ev["k"])
	hasSlot := ev["slot"] != nil
	slot := asInt(ev["slot"])

	switch kind {
	case "morte":
		if asString(ev["quem"]) == "selvagem" && hasSlot {
			t.encounters[slot] = &shinyEncounter{
				name:   asString(ev["nome"]),
				seenAt: now,
			}
		}
	case "bola":
		if !hasSlot {
			return false, false
		}
		e := t.encounters[slot]
		if e == nil {
			e = &shinyEncounter{name: asString(ev["nome"]), seenAt: now}
			t.encounters[slot] = e
		}
		e.seenAt = now
		shiny := asBool(ev["shiny"])
		success := asBool(ev["sucesso"])
		if shiny && !e.seen {
			e.seen = true
			t.Seen++
			newSeen = true
		}
		if shiny && success && !e.captured {
			e.captured = true
			t.Captured++
			newCaptured = true
		}
		if shiny && !success {
			e.failedAt = now
		} else {
			e.failedAt = time.Time{}
		}
		return newSeen, newCaptured
	case "fugiu":
		if !asBool(ev["shiny"]) {
			return false, false
		}
		name := strings.ToLower(strings.TrimSpace(asString(ev["nome"])))
		var matches []*shinyEncounter
		for k, e := range t.encounters {
			if !e.seen || e.failedAt.IsZero() || now.Sub(e.failedAt) >= 10*time.Second {
				continue
			}
			en := strings.ToLower(strings.TrimSpace(e.name))
			if hasSlot && k == slot && (en == "" || en == name) {
				matches = append(matches, e)
			} else if !hasSlot && name != "" && en == name {
				matches = append(matches, e)
			}
		}
		if len(matches) == 1 {
			matches[0].failedAt = time.Time{}
		} else {
			t.Seen++
			return true, false
		}
	}
	return false, false
}

// --- Outland & Battle Pass Helpers ---

func HuntIsOutland(hunts []any, slug string) (bool, bool) {
	if slug == "" {
		return false, false
	}
	for _, raw := range hunts {
		h := asMap(raw)
		if h == nil || asString(h["slug"]) != slug {
			continue
		}
		area := strings.ToLower(asString(h["area"]))
		region := strings.ToLower(asString(h["regiao"]))
		if area == "" && region == "" {
			return false, false
		}
		return strings.HasPrefix(area, "outland") || strings.HasPrefix(region, "outland"), true
	}
	return false, false
}

const (
	PassMinLevel  = 10
	passOffsetMs  = 3 * 60 * 60 * 1000
	dayMs         = 24 * 60 * 60 * 1000
)

func PassDay(nowMs int64) int64 {
	return int64(math.Floor(float64(nowMs-passOffsetMs) / float64(dayMs)))
}

func CanClaimPass(passe map[string]any, level int, nowMs int64) bool {
	if level < PassMinLevel || passe == nil {
		return false
	}
	today := PassDay(nowMs)
	degrau := asInt(passe["degrau"])
	hasUltimo := passe["ultimo"] != nil
	ultimo := asInt64(passe["ultimo"])
	alreadyClaimed := hasUltimo && degrau >= 1 && ultimo == today
	if !alreadyClaimed {
		return true
	}
	vipUntil := asInt64(passe["vipAte"])
	if vipUntil > nowMs {
		hasUltimoVip := passe["ultimoVip"] != nil
		ultimoVip := asInt64(passe["ultimoVip"])
		return !hasUltimoVip || ultimoVip != today
	}
	return false
}
