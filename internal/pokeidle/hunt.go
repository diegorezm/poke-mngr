package pokeidle

import (
	"time"
)

type HuntSession struct {
	Slug       string
	Name       string
	StartedAt  time.Time
	Kills      int64
	XPGained   int64
	GoldGained int64
}

func (hs *HuntSession) ElapsedHours() float64 {
	if hs == nil || hs.StartedAt.IsZero() {
		return 1e-9
	}
	h := time.Since(hs.StartedAt).Hours()
	if h < 1e-9 {
		return 1e-9
	}
	return h
}

func (hs *HuntSession) XPPerHour() float64 {
	if hs == nil {
		return 0
	}
	return float64(hs.XPGained) / hs.ElapsedHours()
}

func (hs *HuntSession) GoldPerHour() float64 {
	if hs == nil {
		return 0
	}
	return float64(hs.GoldGained) / hs.ElapsedHours()
}

func (hs *HuntSession) KillsPerHour() float64 {
	if hs == nil {
		return 0
	}
	return float64(hs.Kills) / hs.ElapsedHours()
}

type HuntManager struct {
	Estado  map[string]any
	Hunts   []any
	Session *HuntSession
	OnKill  func(xp, gold int64)
}

func NewHuntManager() *HuntManager {
	return &HuntManager{
		Estado: map[string]any{},
	}
}

func (hm *HuntManager) OnWelcome(estado map[string]any, hunts []any) {
	hm.Estado = estado
	if hm.Estado == nil {
		hm.Estado = map[string]any{}
	}
	hm.Hunts = hunts
	slug := asString(hm.Estado["huntSlug"])
	hm.Session = &HuntSession{
		Slug:      slug,
		Name:      hm.huntName(slug),
		StartedAt: time.Now(),
	}
}

func (hm *HuntManager) huntName(slug string) string {
	for _, raw := range hm.Hunts {
		h := asMap(raw)
		if h != nil && asString(h["slug"]) == slug {
			if n := asString(h["nome"]); n != "" {
				return n
			}
		}
	}
	return slug
}

func (hm *HuntManager) HandleEstadoPatch(patch map[string]any) {
	if patch == nil {
		return
	}
	if asBool(patch["cheio"]) {
		hm.Estado = deepCloneMap(patch)
		return
	}
	var pkMud []any
	var pkFora []any
	for k, v := range patch {
		switch k {
		case "pkMud":
			pkMud = asSlice(v)
		case "pkFora":
			pkFora = asSlice(v)
		default:
			hm.Estado[k] = v
		}
	}
	if len(pkMud) > 0 {
		hm.applyPkMud(pkMud)
	}
	if len(pkFora) > 0 {
		hm.applyPkFora(pkFora)
	}
}

func (hm *HuntManager) applyPkMud(patches []any) {
	pks := asSlice(hm.Estado["pokemons"])
	byID := make(map[int]map[string]any, len(pks))
	for _, raw := range pks {
		if m := asMap(raw); m != nil {
			byID[asInt(m["id"])] = m
		}
	}
	for _, raw := range patches {
		p := asMap(raw)
		if p == nil {
			continue
		}
		pid := asInt(p["id"])
		if existing, ok := byID[pid]; ok {
			for k, v := range p {
				existing[k] = v
			}
		} else {
			clone := deepCloneMap(p)
			pks = append(pks, clone)
			byID[pid] = clone
		}
	}
	hm.Estado["pokemons"] = pks
}

func (hm *HuntManager) applyPkFora(ids []any) {
	remove := make(map[int]bool, len(ids))
	for _, raw := range ids {
		if id := asInt(raw); id != 0 {
			remove[id] = true
		}
	}
	if len(remove) == 0 {
		return
	}
	pks := asSlice(hm.Estado["pokemons"])
	filtered := make([]any, 0, len(pks))
	for _, raw := range pks {
		if m := asMap(raw); m != nil && remove[asInt(m["id"])] {
			continue
		}
		filtered = append(filtered, raw)
	}
	hm.Estado["pokemons"] = filtered
}

func (hm *HuntManager) HandleBattleEvent(ev map[string]any) {
	kind := asString(ev["k"])
	switch kind {
	case "hunt":
		slug := asString(ev["slug"])
		nome := asString(ev["nome"])
		if nome == "" {
			nome = hm.huntName(slug)
		}
		hm.Session = &HuntSession{
			Slug:      slug,
			Name:      nome,
			StartedAt: time.Now(),
		}
	case "morte":
		if asString(ev["quem"]) == "selvagem" {
			if hm.Session == nil {
				slug := asString(hm.Estado["huntSlug"])
				hm.Session = &HuntSession{
					Slug:      slug,
					Name:      hm.huntName(slug),
					StartedAt: time.Now(),
				}
			}
			xp := asInt64(ev["xpTreinador"])
			if xp == 0 {
				xp = asInt64(ev["xp"])
			}
			gold := asInt64(ev["ouro"]) + asInt64(ev["ouroVendaAuto"])
			hm.Session.Kills++
			hm.Session.XPGained += xp
			hm.Session.GoldGained += gold
			if hm.OnKill != nil {
				hm.OnKill(xp, gold)
			}
		}
	}
}

func (hm *HuntManager) ActivePokemon() map[string]any {
	activeID := asInt(hm.Estado["activeId"])
	if activeID == 0 {
		return nil
	}
	for _, raw := range asSlice(hm.Estado["pokemons"]) {
		if m := asMap(raw); m != nil && asInt(m["id"]) == activeID {
			return m
		}
	}
	return nil
}

func (hm *HuntManager) ActivePokemonSummary() *PokemonSummary {
	pk := hm.ActivePokemon()
	if pk == nil {
		return nil
	}
	name := asString(pk["apelido"])
	if name == "" {
		name = asString(pk["nome"])
	}
	if name == "" {
		name = asString(pk["especie"])
	}
	return &PokemonSummary{
		ID:         asInt(pk["id"]),
		Name:       name,
		Species:    asString(pk["especie"]),
		Level:      asInt(pk["level"]),
		HP:         asInt(pk["hp"]),
		MaxHP:      asInt(pk["maxHp"]),
		XP:         asInt64(pk["xp"]),
		XPNext:     asInt64(pk["xpProximo"]),
		Shiny:      asBool(pk["shiny"]),
		Looktype:   lookOf(pk),
		HeldItemID: asInt(pk["heldItemId"]),
	}
}
