package pokeidle

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"poke-mngr/internal/config"
	"poke-mngr/internal/store"
)

// TestAutomationLoopNoRecursiveRLockDeadlock verifies that automationLoop's
// huntQueueTicker and ballTicker never deadlock ac.mu when concurrent writers
// acquire ac.mu.Lock() (e.g., incoming WebSocket frames and Snapshot reads).
func TestAutomationLoopNoRecursiveRLockDeadlock(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "deadlock.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	acc := config.AccountRecord{
		ID:      1,
		Nick:    "AshDeadlockTest",
		Enabled: true,
		Options: config.DefaultAccountOptions(),
	}
	ac := NewAccountConnection(acc, config.DefaultGlobalSettings(), st, NewNotifier(""), NewItemCatalog(), nil, nil)
	ac.handleWelcome(map[string]any{
		"estado": map[string]any{
			"level":         100,
			"gold":          100000,
			"servidorAgora": time.Now().UnixMilli(),
			"balls":         map[string]any{"4": 50},
		},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 1300*time.Millisecond)
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(3)

	go func() {
		defer wg.Done()
		ac.automationLoop(ctx)
	}()

	go func() {
		defer wg.Done()
		for ctx.Err() == nil {
			ac.mu.Lock()
			ac.lastFrameAt = time.Now()
			ac.hunt.Estado["gold"] = time.Now().UnixNano()
			ac.mu.Unlock()
			time.Sleep(500 * time.Microsecond)
		}
	}()

	go func() {
		defer wg.Done()
		for ctx.Err() == nil {
			_ = ac.Snapshot()
			time.Sleep(5 * time.Millisecond)
		}
	}()

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(4 * time.Second):
		t.Fatal("deadlock detected in AccountConnection.automationLoop / ac.mu")
	}
}

// TestHandleBattleKillNoSelfDeadlock verifies that processing a wild kill frame
// ("batalha" -> k:"morte", quem:"selvagem") does not self-deadlock ac.mu and
// records the kill in daily_state.
func TestHandleBattleKillNoSelfDeadlock(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kill.db")
	st, err := store.Open(dbPath)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	gs := config.DefaultGlobalSettings()
	acc := config.AccountRecord{
		ID:      1,
		Nick:    "AshKillTest",
		Enabled: true,
		Options: config.DefaultAccountOptions(),
	}
	ac := NewAccountConnection(acc, gs, st, NewNotifier(""), NewItemCatalog(), nil, nil)
	ac.handleWelcome(map[string]any{
		"estado": map[string]any{
			"huntSlug": "kanto-1",
			"level":    50,
		},
	})

	done := make(chan error, 1)
	go func() {
		done <- ac.handleFrame(context.Background(), map[string]any{
			"t": "batalha",
			"ev": []any{
				map[string]any{
					"k":           "morte",
					"quem":        "selvagem",
					"nome":        "Pikachu",
					"slot":        1,
					"xpTreinador": float64(250),
					"ouro":        float64(120),
				},
			},
		}, nil)
	}()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("handleFrame returned unexpected error: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("self-deadlock detected in handleFrame(batalha/morte)")
	}

	snap := ac.Snapshot()
	if snap.Hunt.Kills != 1 || snap.Hunt.XPGained != 250 || snap.Hunt.GoldGained != 120 {
		t.Fatalf("unexpected hunt stats: %+v", snap.Hunt)
	}
	period := CurrentDailyPeriod(time.Now(), gs.DailyReportHour, gs.ReportTZ)
	rows, err := st.LoadDailyPeriod(period)
	if err != nil {
		t.Fatalf("LoadDailyPeriod: %v", err)
	}
	if len(rows) != 1 || rows[0].Kills != 1 || rows[0].XP != 250 || rows[0].Gold != 120 {
		t.Fatalf("expected persisted daily kill, got %+v", rows)
	}
}
