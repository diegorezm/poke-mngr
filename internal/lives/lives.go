package lives

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"poke-mngr/internal/pokeidle"
	"poke-mngr/internal/store"
)

const twitchClientID = "kimne78kx3ncx6brgo4mv6wki5h1ko"

// VisibleAndMuteJS prevents Twitch/Kick players from throttling when hidden and keeps them muted.
const VisibleAndMuteJS = `(function() {
  try {
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(Document.prototype, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(Document.prototype, 'webkitVisibilityState', { get: () => 'visible', configurable: true });
    Object.defineProperty(Document.prototype, 'webkitHidden', { get: () => false, configurable: true });
    Document.prototype.hasFocus = function() { return true; };
    window.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    document.addEventListener('visibilitychange', e => e.stopImmediatePropagation(), true);
    document.addEventListener('play', e => {
      try { if (e.target && 'muted' in e.target) { e.target.muted = true; e.target.volume = 0; } } catch(_) {}
    }, true);
    setInterval(() => {
      try {
        document.querySelectorAll('video, audio').forEach(m => {
          m.muted = true; m.volume = 0;
          if (m.paused && m.readyState >= 2) m.play().catch(() => {});
        });
        var accept = document.querySelector('[data-a-target="player-overlay-mature-accept"], [data-a-target="content-classification-gate-overlay-start-watching-button"]');
        if (accept) accept.click();
      } catch(_) {}
    }, 5000);
  } catch(_) {}
})();`

type ChannelStatus struct {
	Site     string `json:"site"` // "twitch" | "kick"
	Channel  string `json:"channel"`
	Name     string `json:"name"`
	Official bool   `json:"official"`
	Live     bool   `json:"live"`
	Viewers  int    `json:"viewers"`
}

type SlotAssignment struct {
	Site    string `json:"site"`
	Slot    int    `json:"slot"` // 1 or 2
	Channel string `json:"channel"`
	StandIn bool   `json:"standIn"`
	Playing bool   `json:"playing"`
}

type AccountLivesState struct {
	AccountID int                      `json:"accountId"`
	Nick      string                   `json:"nick"`
	Config    store.LivesAccountConfig `json:"config"`
	Slots     []SlotAssignment         `json:"slots"`
}

type CentralState struct {
	OfficialFresh bool                 `json:"officialFresh"`
	Channels      []ChannelStatus      `json:"channels"`
	Accounts      []AccountLivesState  `json:"accounts"`
	Logs          []store.LivesLogEntry `json:"logs"`
}

type Manager struct {
	mu           sync.RWMutex
	mgr          *pokeidle.AccountManager
	st           *store.Store
	client       *http.Client
	extraLive    map[string]bool // "site:channel" -> live
	activePlayer map[string]string // "accId:site:slot" -> channel
}

func NewManager(mgr *pokeidle.AccountManager, st *store.Store) *Manager {
	return &Manager{
		mgr:          mgr,
		st:           st,
		client:       &http.Client{Timeout: 10 * time.Second},
		extraLive:    map[string]bool{},
		activePlayer: map[string]string{},
	}
}

func (lm *Manager) PlayerURL(site, channel string) string {
	ch := strings.ToLower(strings.TrimSpace(channel))
	if site == "kick" {
		return fmt.Sprintf("https://player.kick.com/%s", ch)
	}
	return fmt.Sprintf("https://player.twitch.tv/?channel=%s&parent=twitch.tv&player=popout", ch)
}

func (lm *Manager) PointsURL(site, channel string) string {
	ch := strings.ToLower(strings.TrimSpace(channel))
	if site == "kick" {
		return fmt.Sprintf("https://kick.com/%s", ch)
	}
	return fmt.Sprintf("https://www.twitch.tv/popout/%s/chat?popout=", ch)
}

func (lm *Manager) LoginURL(site string) string {
	if site == "kick" {
		return "https://kick.com/"
	}
	return "https://www.twitch.tv/login"
}

func (lm *Manager) SetPlayerPlaying(accountID int, site string, slot int, channel string) {
	key := fmt.Sprintf("%d:%s:%d", accountID, site, slot)
	lm.mu.Lock()
	if channel == "" {
		delete(lm.activePlayer, key)
	} else {
		lm.activePlayer[key] = channel
	}
	lm.mu.Unlock()
}

func (lm *Manager) RefreshExtraLiveStatus(ctx context.Context) {
	accs, err := lm.st.ListAccounts()
	if err != nil {
		return
	}
	twSet := map[string]bool{}
	for _, a := range accs {
		cfg := lm.st.LoadLivesConfig(a.ID)
		for _, ch := range cfg.ExtraTwitch {
			if c := strings.ToLower(strings.TrimSpace(ch)); c != "" {
				twSet[c] = true
			}
		}
	}
	if len(twSet) == 0 {
		return
	}
	channels := make([]string, 0, len(twSet))
	for c := range twSet {
		channels = append(channels, c)
	}
	liveMap := lm.queryTwitchLive(ctx, channels)
	lm.mu.Lock()
	for ch, isLive := range liveMap {
		lm.extraLive["twitch:"+ch] = isLive
	}
	lm.mu.Unlock()
}

func (lm *Manager) queryTwitchLive(ctx context.Context, channels []string) map[string]bool {
	out := map[string]bool{}
	var parts []string
	for i, ch := range channels {
		parts = append(parts, fmt.Sprintf(`c%d: user(login: %q) { login stream { id } }`, i, ch))
	}
	payload := map[string]any{"query": "{ " + strings.Join(parts, " ") + " }"}
	b, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://gql.twitch.tv/gql", bytes.NewReader(b))
	if err != nil {
		return out
	}
	req.Header.Set("Client-Id", twitchClientID)
	req.Header.Set("Content-Type", "application/json")
	resp, err := lm.client.Do(req)
	if err != nil {
		return out
	}
	defer resp.Body.Close()
	var parsed struct {
		Data map[string]struct {
			Login  string `json:"login"`
			Stream any    `json:"stream"`
		} `json:"data"`
	}
	if json.NewDecoder(resp.Body).Decode(&parsed) != nil {
		return out
	}
	for _, u := range parsed.Data {
		if u.Login != "" {
			out[strings.ToLower(u.Login)] = u.Stream != nil
		}
	}
	return out
}

func (lm *Manager) State() CentralState {
	twOff, kkOff, fresh := lm.mgr.Official().List()
	chMap := map[string]ChannelStatus{}
	channels := []ChannelStatus{}

	addCh := func(cs ChannelStatus) {
		key := cs.Site + ":" + cs.Channel
		if _, exists := chMap[key]; exists {
			return
		}
		chMap[key] = cs
		channels = append(channels, cs)
	}

	for _, s := range twOff {
		addCh(ChannelStatus{
			Site: "twitch", Channel: s.Channel, Name: s.Name, Official: true, Live: s.Live, Viewers: s.Viewers,
		})
	}
	for _, s := range kkOff {
		addCh(ChannelStatus{
			Site: "kick", Channel: s.Channel, Name: s.Name, Official: true, Live: s.Live, Viewers: s.Viewers,
		})
	}

	accs, _ := lm.st.ListAccounts()
	lm.mu.RLock()
	extraLive := lm.extraLive
	activePlayer := lm.activePlayer
	lm.mu.RUnlock()

	for _, a := range accs {
		cfg := lm.st.LoadLivesConfig(a.ID)
		for _, ch := range cfg.ExtraTwitch {
			c := strings.ToLower(strings.TrimSpace(ch))
			if c != "" {
				addCh(ChannelStatus{Site: "twitch", Channel: c, Name: c, Official: false, Live: extraLive["twitch:"+c]})
			}
		}
		for _, ch := range cfg.ExtraKick {
			c := strings.ToLower(strings.TrimSpace(ch))
			if c != "" {
				addCh(ChannelStatus{Site: "kick", Channel: c, Name: c, Official: false, Live: true})
			}
		}
	}

	accStates := []AccountLivesState{}
	for _, a := range accs {
		cfg := lm.st.LoadLivesConfig(a.ID)
		slots := assignSlots(a.ID, cfg, channels, activePlayer)
		accStates = append(accStates, AccountLivesState{
			AccountID: a.ID,
			Nick:      a.Nick,
			Config:    cfg,
			Slots:     slots,
		})
	}

	logs, _ := lm.st.ListLivesLog(100)
	if logs == nil {
		logs = []store.LivesLogEntry{}
	}
	return CentralState{
		OfficialFresh: fresh,
		Channels:      channels,
		Accounts:      accStates,
		Logs:          logs,
	}
}

func assignSlots(accID int, cfg store.LivesAccountConfig, all []ChannelStatus, activePlayer map[string]string) []SlotAssignment {
	var out []SlotAssignment
	for _, site := range []string{"twitch", "kick"} {
		var livePool []string
		isLive := map[string]bool{}
		for _, ch := range all {
			if ch.Site == site && ch.Live {
				livePool = append(livePool, ch.Channel)
				isLive[ch.Channel] = true
			}
		}
		used := map[string]bool{}
		prefs := []string{cfg.TwitchSlot1, cfg.TwitchSlot2}
		if site == "kick" {
			prefs = []string{cfg.KickSlot1, cfg.KickSlot2}
		}
		for i, pref := range prefs {
			slot := i + 1
			p := strings.ToLower(strings.TrimSpace(pref))
			if p == "none" {
				out = append(out, SlotAssignment{Site: site, Slot: slot})
				continue
			}
			chosen := ""
			standIn := false
			if p != "" && isLive[p] && !used[p] {
				chosen = p
			} else {
				for _, cand := range livePool {
					if !used[cand] {
						chosen = cand
						standIn = p != ""
						break
					}
				}
			}
			if chosen != "" {
				used[chosen] = true
			}
			key := fmt.Sprintf("%d:%s:%d", accID, site, slot)
			out = append(out, SlotAssignment{
				Site:    site,
				Slot:    slot,
				Channel: chosen,
				StandIn: standIn,
				Playing: activePlayer[key] != "" && activePlayer[key] == chosen,
			})
		}
	}
	return out
}
