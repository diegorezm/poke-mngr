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

	ctx, cancel := context.WithTimeout(context.Background(), 2200*time.Millisecond)
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(3)

	// 1. Run automationLoop (fires ballTicker every 200ms and huntQueueTicker every 1s)
	go func() {
		defer wg.Done()
		ac.automationLoop(ctx)
	}()

	// 2. Hammer ac.mu.Lock() like incoming WS frames
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

	// 3. Hammer Snapshot() like telemetryLoop / Wails RPCs
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
	case <-time.After(5 * time.Second):
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

	// Verify ac.mu is completely free and daily kill was persisted
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

func TestShopCancelSellAllowsRetry(t *testing.T) {
	sm := NewShopManager()
	ch1, err := sm.BeginSell()
	if err != nil {
		t.Fatalf("first BeginSell failed: %v", err)
	}
	if _, err := sm.BeginSell(); err == nil {
		t.Fatal("expected second concurrent BeginSell to fail")
	}
	sm.CancelSell(ch1)
	ch2, err := sm.BeginSell()
	if err != nil {
		t.Fatalf("BeginSell after CancelSell failed: %v", err)
	}
	// Cancelling the old channel must not clear the new one
	sm.CancelSell(ch1)
	if _, err := sm.BeginSell(); err == nil {
		t.Fatal("CancelSell with stale channel should not clear active sell")
	}
	sm.CancelSell(ch2)
}

func TestMarketServicePruneCaches(t *testing.T) {
	ms := &MarketService{
		guideCache:  map[string]guideCacheEntry{},
		seenAlerted: map[string]time.Time{},
		snipedIDs:   map[int]time.Time{},
		shinyCache:  map[string]shinyPriceCacheEntry{},
		sellAlerted: map[string]sellAlertEntry{},
	}
	now := time.Now()
	ms.guideCache["old"] = guideCacheEntry{exp: now.Add(-time.Minute)}
	ms.guideCache["new"] = guideCacheEntry{exp: now.Add(time.Minute)}
	ms.shinyCache["old"] = shinyPriceCacheEntry{exp: now.Add(-time.Minute)}
	ms.shinyCache["new"] = shinyPriceCacheEntry{exp: now.Add(time.Minute)}
	ms.seenAlerted["old"] = now.Add(-25 * time.Hour)
	ms.seenAlerted["new"] = now.Add(-time.Hour)
	ms.snipedIDs[1] = now.Add(-25 * time.Hour)
	ms.snipedIDs[2] = now.Add(-time.Hour)
	ms.sellAlerted["old"] = sellAlertEntry{at: now.Add(-25 * time.Hour)}
	ms.sellAlerted["new"] = sellAlertEntry{at: now.Add(-time.Hour)}

	ms.pruneCaches(now)

	if len(ms.guideCache) != 1 || len(ms.shinyCache) != 1 || len(ms.seenAlerted) != 1 || len(ms.snipedIDs) != 1 || len(ms.sellAlerted) != 1 {
		t.Fatalf("expected only fresh entries after prune, got guide=%d shiny=%d seen=%d sniped=%d sell=%d",
			len(ms.guideCache), len(ms.shinyCache), len(ms.seenAlerted), len(ms.snipedIDs), len(ms.sellAlerted))
	}
}
