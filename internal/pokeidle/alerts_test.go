package pokeidle

import (
	"path/filepath"
	"strings"
	"testing"
	"time"

	"poke-mngr/internal/config"
	"poke-mngr/internal/store"
)

func TestCurrentDailyPeriod(t *testing.T) {
	// 2026-05-10 02:30 UTC == 2026-05-09 23:30 America/Sao_Paulo (UTC-3)
	utc := time.Date(2026, 5, 10, 2, 30, 0, 0, time.UTC)
	if got := CurrentDailyPeriod(utc, 0, "America/Sao_Paulo"); got != "2026-05-09" {
		t.Fatalf("expected 2026-05-09, got %s", got)
	}
	// 2026-05-10 06:30 UTC == 2026-05-10 03:30 America/Sao_Paulo -> with reportHour=4, still 2026-05-09
	utc2 := time.Date(2026, 5, 10, 6, 30, 0, 0, time.UTC)
	if got := CurrentDailyPeriod(utc2, 4, "America/Sao_Paulo"); got != "2026-05-09" {
		t.Fatalf("expected 2026-05-09 before 04:00 rollover, got %s", got)
	}
	// 2026-05-10 07:30 UTC == 2026-05-10 04:30 America/Sao_Paulo -> with reportHour=4, now 2026-05-10
	utc3 := time.Date(2026, 5, 10, 7, 30, 0, 0, time.UTC)
	if got := CurrentDailyPeriod(utc3, 4, "America/Sao_Paulo"); got != "2026-05-10" {
		t.Fatalf("expected 2026-05-10 after 04:00 rollover, got %s", got)
	}
}

func TestBuildDailyReportEmbed(t *testing.T) {
	rows := []store.DailyAccountStats{
		{Nick: "Ash", XP: 1250000, Gold: 45000, Kills: 310, Items: map[string]int{"boss": 2}},
		{Nick: "Misty", XP: 500000, Gold: 15000, Kills: 120, Items: map[string]int{"shinyStone": 1}},
	}
	embed := BuildDailyReportEmbed("2026-05-09", rows)
	if !strings.Contains(embed.Title, "09/05/2026") {
		t.Fatalf("unexpected title: %s", embed.Title)
	}
	if len(embed.Fields) != 3 {
		t.Fatalf("expected 2 accounts + Total field, got %d", len(embed.Fields))
	}
	if embed.Fields[2].Name != "Total" {
		t.Fatalf("expected Total field, got %s", embed.Fields[2].Name)
	}
	if !strings.Contains(embed.Fields[2].Value, "1.750.000") {
		t.Fatalf("expected formatted total XP 1.750.000, got %s", embed.Fields[2].Value)
	}
}

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

func TestBridgeBootstrapJSContainsLiveHandlers(t *testing.T) {
	js := buildBridgeBootstrapJS(1, "Ash", "tok", "dev", 9999, "sec", true, false)
	for _, want := range []string{
		"__pokeMngrDeck",
		"setUltra",
		"setReduceMotion",
		"CSSMediaRule",
		"#cfg-ultra",
		"#ultra-sair",
		"addEventListener('message'",
	} {
		if !strings.Contains(js, want) {
			t.Fatalf("expected bootstrap JS to contain %q", want)
		}
	}
}
