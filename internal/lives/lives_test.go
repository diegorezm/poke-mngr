package lives

import (
	"testing"

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
