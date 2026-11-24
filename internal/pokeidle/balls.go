package pokeidle

import (
	"sync"
	"time"

	"poke-mngr/internal/config"
)

type BallManager struct {
	mu           sync.Mutex
	corpses      map[int]time.Time // slot -> deadline
	pending      map[int]bool
	lastThrowAt  time.Time
	Caught       int
	Failed       int
	BallPriority []int
}

func NewBallManager(priority []int) *BallManager {
	if len(priority) == 0 {
		priority = append([]int(nil), config.DefaultBallPriority...)
	}
	return &BallManager{
		corpses:      map[int]time.Time{},
		pending:      map[int]bool{},
		BallPriority: priority,
	}
}

func (bm *BallManager) Reset() {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.corpses = map[int]time.Time{}
	bm.pending = map[int]bool{}
}

func (bm *BallManager) HandleBattleEvent(ev map[string]any) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	kind := asString(ev["k"])
	if ev["slot"] == nil {
		return
	}
	slot := asInt(ev["slot"])

	switch kind {
	case "morte":
		if asString(ev["quem"]) == "selvagem" {
			bm.corpses[slot] = time.Now().Add(config.CorpseWindow)
		}
	case "bola":
		delete(bm.pending, slot)
		delete(bm.corpses, slot)
		if asBool(ev["sucesso"]) {
			bm.Caught++
		} else {
			bm.Failed++
		}
	}
}

func (bm *BallManager) MarkThrown(slot int) {
	bm.mu.Lock()
	defer bm.mu.Unlock()
	bm.pending[slot] = true
	bm.lastThrowAt = time.Now()
}

// NextThrow returns (slot, ballID, ok) following FIFO order and 1.3s global cooldown.
func (bm *BallManager) NextThrow(estado map[string]any) (int, int, bool) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	now := time.Now()
	for slot, dl := range bm.corpses {
		if now.After(dl) {
			delete(bm.corpses, slot)
			delete(bm.pending, slot)
		}
	}
	if now.Sub(bm.lastThrowAt) < config.BallThrowCooldown {
		return 0, 0, false
	}

	var bestSlot int
	var bestDL time.Time
	found := false
	for slot, dl := range bm.corpses {
		if bm.pending[slot] {
			continue
		}
		if !found || dl.Before(bestDL) {
			bestSlot = slot
			bestDL = dl
			found = true
		}
	}
	if !found {
		return 0, 0, false
	}

	ballID := bm.pickBall(estado)
	if ballID == 0 {
		return 0, 0, false
	}
	bm.pending[bestSlot] = true
	bm.lastThrowAt = now
	return bestSlot, ballID, true
}

func (bm *BallManager) pickBall(estado map[string]any) int {
	balls := asMap(estado["balls"])
	auto := asMap(estado["automation"])
	if auto != nil {
		for _, bid := range asIntSlice(auto["ballIds"]) {
			if mapIntValue(balls, bid) > 0 {
				return bid
			}
		}
	}
	for _, bid := range bm.BallPriority {
		if mapIntValue(balls, bid) > 0 {
			return bid
		}
	}
	return 0
}
