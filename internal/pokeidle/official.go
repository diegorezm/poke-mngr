package pokeidle

import (
	"strings"
	"sync"
	"time"
)

type OfficialStreamer struct {
	Site    string `json:"site"` // "twitch" | "kick"
	Channel string `json:"channel"`
	Name    string `json:"name"`
	Live    bool   `json:"live"`
	Active  bool   `json:"active"`
	Viewers int    `json:"viewers"`
}

// OfficialStreamers passively syncs PokéIdle's official Twitch/Kick streamer lists
// reported inside `estado.twitch.oficiais` and `estado.kick.oficiais`.
type OfficialStreamers struct {
	mu        sync.RWMutex
	twitch    []OfficialStreamer
	kick      []OfficialStreamer
	updatedAt time.Time
	onChange  func()
}

func NewOfficialStreamers() *OfficialStreamers {
	return &OfficialStreamers{}
}

func (o *OfficialStreamers) OnChange(fn func()) {
	o.mu.Lock()
	o.onChange = fn
	o.mu.Unlock()
}

func (o *OfficialStreamers) UpdateFromEstado(estado map[string]any) {
	if estado == nil {
		return
	}
	var twitchList []OfficialStreamer
	var kickList []OfficialStreamer
	hasTwitch := false
	hasKick := false

	if tw := asMap(estado["twitch"]); tw != nil && tw["oficiais"] != nil {
		hasTwitch = true
		for _, raw := range asSlice(tw["oficiais"]) {
			m := asMap(raw)
			if m == nil {
				continue
			}
			ch := strings.ToLower(strings.TrimSpace(asString(m["login"])))
			if ch == "" {
				continue
			}
			twitchList = append(twitchList, OfficialStreamer{
				Site:    "twitch",
				Channel: ch,
				Name:    asString(m["nome"]),
				Live:    asBool(m["aoVivo"]),
				Active:  asBool(m["ativo"]),
				Viewers: asInt(m["espectadores"]),
			})
		}
	}

	if kk := asMap(estado["kick"]); kk != nil && kk["oficiais"] != nil {
		hasKick = true
		for _, raw := range asSlice(kk["oficiais"]) {
			m := asMap(raw)
			if m == nil {
				continue
			}
			ch := strings.ToLower(strings.TrimSpace(asString(m["slug"])))
			if ch == "" {
				continue
			}
			kickList = append(kickList, OfficialStreamer{
				Site:    "kick",
				Channel: ch,
				Name:    asString(m["nome"]),
				Live:    asBool(m["aoVivo"]),
				Active:  asBool(m["ativo"]),
				Viewers: asInt(m["espectadores"]),
			})
		}
	}

	if !hasTwitch && !hasKick {
		return
	}

	o.mu.Lock()
	changed := false
	if hasTwitch && !sameStreamers(o.twitch, twitchList) {
		o.twitch = twitchList
		changed = true
	}
	if hasKick && !sameStreamers(o.kick, kickList) {
		o.kick = kickList
		changed = true
	}
	o.updatedAt = time.Now()
	cb := o.onChange
	o.mu.Unlock()

	if changed && cb != nil {
		go cb()
	}
}

func (o *OfficialStreamers) List() (twitch []OfficialStreamer, kick []OfficialStreamer, fresh bool) {
	o.mu.RLock()
	defer o.mu.RUnlock()
	fresh = !o.updatedAt.IsZero() && time.Since(o.updatedAt) < 5*time.Minute
	twitch = append([]OfficialStreamer(nil), o.twitch...)
	kick = append([]OfficialStreamer(nil), o.kick...)
	return
}

func sameStreamers(a, b []OfficialStreamer) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].Channel != b[i].Channel || a[i].Live != b[i].Live || a[i].Active != b[i].Active {
			return false
		}
	}
	return true
}
