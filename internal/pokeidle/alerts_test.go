package pokeidle

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"poke-mngr/internal/config"
	"poke-mngr/internal/store"
)

func TestDailyRolloverQueuesReport(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	gs := config.DefaultGlobalSettings()
	gs.DiscordWebhookURL = "https://discord.com/api/webhooks/test/token"
	gs.DailyReportHour = 0
	gs.ReportTZ = "America/Sao_Paulo"
	_ = st.SaveGlobalSettings(gs)

	mgr := NewAccountManager(st)

	day1 := time.Date(2026, 5, 9, 15, 0, 0, 0, time.UTC)
	if rolled := mgr.CheckDailyRollover(day1); rolled {
		t.Fatalf("first check should initialize period without rollover")
	}

	_ = st.AddDailyKill("2026-05-09", "Ash", 10000, 2500)
	_ = st.AddDailyRareItem("2026-05-09", "Ash", "boss", 1)

	day2 := time.Date(2026, 5, 10, 4, 0, 0, 0, time.UTC) // 01:00 BRT on May 10
	if rolled := mgr.CheckDailyRollover(day2); !rolled {
		t.Fatalf("expected rollover on day2")
	}

	select {
	case embed := <-mgr.notifier.queue:
		if !strings.Contains(embed.Title, "09/05/2026") {
			t.Fatalf("unexpected report title: %s", embed.Title)
		}
		if len(embed.Fields) != 1 || embed.Fields[0].Name != "Ash" {
			t.Fatalf("unexpected fields: %+v", embed.Fields)
		}
	default:
		t.Fatalf("expected daily report embed queued in notifier")
	}
}

func TestDisconnectAndReconnectAlerts(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	gs := config.DefaultGlobalSettings()
	gs.DiscordWebhookURL = "https://discord.com/api/webhooks/test/token"
	gs.DownAlertDelaySec = 0 // immediate alert for unit test
	notifier := NewNotifier(gs.DiscordWebhookURL)

	acc := config.AccountRecord{ID: 1, Nick: "Red", Token: "tok", DeviceID: "dev", Enabled: true}
	ac := NewAccountConnection(acc, gs, st, notifier, NewItemCatalog(), nil, nil)

	// Not yet online -> disconnect should not alert.
	ac.scheduleDisconnectAlert("falha inicial")
	select {
	case ev := <-notifier.queue:
		t.Fatalf("should not alert before first online, got %+v", ev)
	default:
	}

	// Mark online, then disconnect -> should alert immediately (downSec == 0).
	ac.mu.Lock()
	ac.wasOnline = true
	ac.state = StateDisconnected
	ac.mu.Unlock()
	ac.scheduleDisconnectAlert("O jogo reiniciou o servidor.")

	select {
	case ev := <-notifier.queue:
		if ev.Title != "Red" || !strings.Contains(ev.Description, "Caiu") {
			t.Fatalf("unexpected down embed: %+v", ev)
		}
	default:
		t.Fatalf("expected down alert embed")
	}

	// Second disconnect while already alerted should not duplicate.
	ac.scheduleDisconnectAlert("ainda fora")
	select {
	case ev := <-notifier.queue:
		t.Fatalf("unexpected duplicate down embed: %+v", ev)
	default:
	}
}
