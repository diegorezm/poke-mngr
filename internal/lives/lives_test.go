package lives

import (
	"path/filepath"
	"sync"
	"testing"

	"poke-mngr/internal/config"
	"poke-mngr/internal/pokeidle"
	"poke-mngr/internal/store"
)

func TestAssignSlotsStandIn(t *testing.T) {
	channels := []ChannelStatus{
		{Site: "twitch", Channel: "offline_fav", Live: false},
		{Site: "twitch", Channel: "live_a", Live: true},
		{Site: "twitch", Channel: "live_b", Live: true},
		{Site: "kick", Channel: "kick_a", Live: true},
	}
	cfg := store.DefaultLivesAccountConfig()
	cfg.TwitchSlot1 = "offline_fav" // offline -> should fall back with standIn=true
	cfg.TwitchSlot2 = ""            // auto -> live_b
	cfg.KickSlot2 = "none"

	slots := assignSlots(1, cfg, channels, map[string]string{})
	if len(slots) != 4 {
		t.Fatalf("expected 4 slots, got %d", len(slots))
	}
	if slots[0].Channel != "live_a" || !slots[0].StandIn {
		t.Fatalf("expected stand-in live_a on twitch slot 1, got %+v", slots[0])
	}
	if slots[1].Channel != "live_b" || slots[1].StandIn {
		t.Fatalf("expected auto live_b on twitch slot 2, got %+v", slots[1])
	}
	if slots[2].Channel != "kick_a" || slots[3].Channel != "" {
		t.Fatalf("unexpected kick slots: %+v %+v", slots[2], slots[3])
	}
}

func TestManagerStateConcurrentMapSafety(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "lives.db"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	acc, err := st.AddAccount(config.AccountRecord{
		Nick:    "LiveTester",
		Token:   "tok123",
		Enabled: true,
		Options: config.DefaultAccountOptions(),
	})
	if err != nil {
		t.Fatalf("AddAccount: %v", err)
	}
	cfg := store.DefaultLivesAccountConfig()
	cfg.ExtraTwitch = []string{"extra1", "extra2"}
	if err := st.SaveLivesConfig(acc.ID, cfg); err != nil {
		t.Fatalf("SaveLivesConfig: %v", err)
	}

	mgr := pokeidle.NewAccountManager(st)
	lm := NewManager(mgr, st)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 200; i++ {
			lm.SetPlayerPlaying(acc.ID, "twitch", 1, "extra1")
			lm.SetPlayerPlaying(acc.ID, "twitch", 1, "")
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 200; i++ {
			_ = lm.State()
		}
	}()
	wg.Wait()
}
