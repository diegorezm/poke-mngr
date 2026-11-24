package pokeidle

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

const (
	pvpLevelMin      = 150
	pvpTeamMax       = 5
	pvpBetweenMatch  = 20 * time.Second
	pvpEnterGap      = 4 * time.Second
	pvpConfirmWait   = 12 * time.Second
	pvpRefuseBase    = 45 * time.Second
	pvpRefuseMax     = 600 * time.Second
	pvpInfoInterval  = 90 * time.Second
)

type PvpMatchEntry struct {
	ID       any    `json:"id"`
	Won      bool   `json:"won"`
	Delta    int    `json:"delta"`
	Opponent string `json:"opponent"`
	Points   int    `json:"points"`
	At       int64  `json:"at"`
}

type PvpAccountView struct {
	AccountID     int            `json:"accountId"`
	Nick          string         `json:"nick"`
	Level         int            `json:"level"`
	Online        bool           `json:"online"`
	Auto          bool           `json:"auto"`
	NativeAuto    bool           `json:"nativeAuto"`
	InQueue       bool           `json:"inQueue"`
	QueueSize     int            `json:"queueSize"`
	WaitSec       int            `json:"waitSec"`
	Position      int            `json:"position"`
	FinalPosition int            `json:"finalPosition"`
	FinalCut      int            `json:"finalCut"`
	TotalRanked   int            `json:"totalRanked"`
	Rank          map[string]any `json:"rank,omitempty"`
	Team          []int          `json:"team"`
	Houses        map[string]int `json:"houses"`
	Wins          int            `json:"wins"`
	Losses        int            `json:"losses"`
	Delta         int            `json:"delta"`
	Refusal       string         `json:"refusal,omitempty"`
	Matches       []PvpMatchEntry `json:"matches"`
}

type PvpManager struct {
	mu      sync.Mutex
	accName string
	sendFn  func(context.Context, any) error

	auto          bool
	nativeAuto    bool
	rank          map[string]any
	position      int
	finalPosition int
	finalCut      int
	totalRanked   int
	rules         map[string]any
	team          []int
	houses        map[string]int
	inQueue       bool
	queueSize     int
	waitUntil     time.Time
	lastEnter     time.Time
	lastInfo      time.Time
	pendingEnter  bool
	refusal       string
	refusalsRow   int
	wins          int
	losses        int
	delta         int
	matches       []PvpMatchEntry

	saveCh    chan error
	ladderCh  chan map[string]any
	monthlyCh chan map[string]any
}

func NewPvpManager(accName string, auto bool, sendFn func(context.Context, any) error) *PvpManager {
	return &PvpManager{
		accName: accName,
		auto:    auto,
		sendFn:  sendFn,
		houses:  map[string]int{},
	}
}

func (pm *PvpManager) SetAuto(enabled bool) {
	pm.mu.Lock()
	pm.auto = enabled
	pm.mu.Unlock()
}

func (pm *PvpManager) ResetConnection(estado map[string]any) {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	pm.inQueue = false
	pm.pendingEnter = false
	pm.refusal = ""
	pm.refusalsRow = 0
	pm.lastInfo = time.Time{}
	if r := asMap(estado["pvp"]); r != nil {
		pm.rank = deepCloneMap(r)
	}
	if tm := asIntSlice(estado["pvpTime"]); len(tm) > 0 {
		if len(tm) > pvpTeamMax {
			tm = tm[:pvpTeamMax]
		}
		pm.team = tm
	}
	if q := asMap(estado["pvpFila"]); q != nil {
		pm.inQueue = asBool(q["na"])
		pm.queueSize = asInt(q["tamanho"])
	}
	if auto := asMap(estado["automation"]); auto != nil {
		pm.nativeAuto = asBool(auto["pvpAutoFila"])
	}
}

func (pm *PvpManager) HandleEstado(patch map[string]any) {
	if auto := asMap(patch["automation"]); auto != nil {
		pm.mu.Lock()
		pm.nativeAuto = asBool(auto["pvpAutoFila"])
		pm.mu.Unlock()
	}
}

func (pm *PvpManager) HandleFrame(ctx context.Context, msg map[string]any) {
	t := asString(msg["t"])
	switch t {
	case "pvpTabela":
		pm.mu.Lock()
		ch := pm.ladderCh
		pm.ladderCh = nil
		pm.mu.Unlock()
		if ch != nil {
			select {
			case ch <- msg:
			default:
			}
		}
		return
	case "pvpMensal":
		pm.mu.Lock()
		ch := pm.monthlyCh
		pm.monthlyCh = nil
		pm.mu.Unlock()
		if ch != nil {
			select {
			case ch <- msg:
			default:
			}
		}
		return
	case "pvp":
		pm.handlePvpFrame(ctx, msg)
	}
}

func (pm *PvpManager) handlePvpFrame(ctx context.Context, msg map[string]any) {
	var ackMatchID any
	var saveResult *error

	pm.mu.Lock()
	if r := asMap(msg["rank"]); r != nil {
		pm.rank = deepCloneMap(r)
	}
	if msg["posicao"] != nil {
		pm.position = asInt(msg["posicao"])
	}
	if msg["posicaoFinal"] != nil {
		pm.finalPosition = asInt(msg["posicaoFinal"])
	}
	if msg["corteFinal"] != nil {
		pm.finalCut = asInt(msg["corteFinal"])
	}
	if msg["totalClassificados"] != nil {
		pm.totalRanked = asInt(msg["totalClassificados"])
	}
	if rg := asMap(msg["regras"]); rg != nil {
		pm.rules = rg
	}
	if tm := asIntSlice(msg["time"]); len(tm) > 0 {
		pm.team = tm
	}
	if ts := asIntSlice(msg["timeSalvo"]); msg["timeSalvo"] != nil {
		pm.team = ts
		var nilErr error
		saveResult = &nilErr
	}
	if cs := asMap(msg["casas"]); cs != nil {
		pm.houses = map[string]int{}
		for k, v := range cs {
			pm.houses[k] = asInt(v)
		}
	}
	if cs := asMap(msg["casasSalvas"]); cs != nil {
		pm.houses = map[string]int{}
		for k, v := range cs {
			pm.houses[k] = asInt(v)
		}
	}
	if rec := msg["recusa"]; rec != nil {
		recMsg := asString(rec)
		if rm := asMap(rec); rm != nil {
			recMsg = asString(rm["msg"])
		}
		if recMsg == "" {
			recMsg = "O jogo recusou a equipe"
		}
		err := errors.New(recMsg)
		saveResult = &err
	}
	if fila := asMap(msg["fila"]); fila != nil {
		pm.inQueue = asBool(fila["na"])
		pm.queueSize = asInt(fila["tamanho"])
		if cd := asInt64(fila["cooldownMs"]); cd > 0 {
			pm.waitUntil = time.Now().Add(time.Duration(cd) * time.Millisecond)
		}
		if pm.inQueue {
			pm.pendingEnter = false
			pm.refusalsRow = 0
			pm.refusal = ""
		}
	}
	if rec := msg["filaRecusa"]; rec != nil {
		pm.inQueue = false
		pm.pendingEnter = false
		pm.refusalsRow++
		text := asString(rec)
		var restMs int64
		if rm := asMap(rec); rm != nil {
			text = asString(rm["msg"])
			restMs = asInt64(rm["restaMs"])
		}
		delay := pvpRefuseBase * time.Duration(1<<(pm.refusalsRow-1))
		if delay > pvpRefuseMax {
			delay = pvpRefuseMax
		}
		if restMs > 0 {
			delay = time.Duration(restMs)*time.Millisecond + 500*time.Millisecond
		}
		pm.waitUntil = time.Now().Add(delay)
		pm.refusal = text
	}
	if asBool(msg["filaAutoDesligada"]) {
		pm.nativeAuto = false
	}
	if p := asMap(msg["partida"]); p != nil {
		won := asBool(p["venci"])
		delta := asInt(p["delta"])
		opp := ""
		if om := asMap(p["oponente"]); om != nil {
			opp = asString(om["nick"])
		} else {
			opp = asString(p["oponente"])
		}
		pm.inQueue = false
		pm.pendingEnter = false
		pm.refusalsRow = 0
		pm.refusal = ""
		pm.waitUntil = time.Now().Add(pvpBetweenMatch)
		if won {
			pm.wins++
		} else {
			pm.losses++
		}
		pm.delta += delta
		entry := PvpMatchEntry{
			ID:       p["id"],
			Won:      won,
			Delta:    delta,
			Opponent: opp,
			Points:   asInt(p["pontos"]),
			At:       time.Now().UnixMilli(),
		}
		pm.matches = append([]PvpMatchEntry{entry}, pm.matches...)
		if len(pm.matches) > 30 {
			pm.matches = pm.matches[:30]
		}
		ackMatchID = p["id"]
	}

	var saveCh chan error
	if saveResult != nil && pm.saveCh != nil {
		saveCh = pm.saveCh
		pm.saveCh = nil
	}
	pm.mu.Unlock()

	if saveCh != nil {
		select {
		case saveCh <- *saveResult:
		default:
		}
	}
	if ackMatchID != nil {
		go func() {
			_ = pm.sendFn(ctx, map[string]any{"t": "pvp.partida.vista", "id": ackMatchID})
			_ = pm.RequestInfo(ctx)
		}()
	}
}

func (pm *PvpManager) RequestInfo(ctx context.Context) error {
	pm.mu.Lock()
	pm.lastInfo = time.Now()
	pm.mu.Unlock()
	return pm.sendFn(ctx, map[string]any{"t": "pvp.info", "semLadder": 1})
}

func (pm *PvpManager) EnterQueue(ctx context.Context) error {
	pm.mu.Lock()
	pm.lastEnter = time.Now()
	pm.pendingEnter = true
	pm.mu.Unlock()
	return pm.sendFn(ctx, map[string]any{"t": "pvp.fila.entrar"})
}

func (pm *PvpManager) LeaveQueue(ctx context.Context) error {
	pm.mu.Lock()
	pm.pendingEnter = false
	pm.mu.Unlock()
	return pm.sendFn(ctx, map[string]any{"t": "pvp.fila.sair"})
}

func (pm *PvpManager) SaveTeam(ctx context.Context, pokemonIDs []int, houses map[string]int) error {
	if len(pokemonIDs) == 0 || len(pokemonIDs) > pvpTeamMax {
		return fmt.Errorf("a equipe deve ter de 1 a %d Pokémon", pvpTeamMax)
	}
	ch := make(chan error, 1)
	pm.mu.Lock()
	pm.saveCh = ch
	pm.mu.Unlock()
	defer func() {
		pm.mu.Lock()
		if pm.saveCh == ch {
			pm.saveCh = nil
		}
		pm.mu.Unlock()
	}()

	if err := pm.sendFn(ctx, map[string]any{
		"t":          "pvp.time.salvar",
		"pokemonIds": pokemonIDs,
		"casas":      houses,
	}); err != nil {
		return err
	}
	select {
	case err := <-ch:
		return err
	case <-time.After(10 * time.Second):
		return errors.New("tempo esgotado salvando equipe PvP")
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (pm *PvpManager) RequestLadder(ctx context.Context, page int) (map[string]any, error) {
	if page < 1 {
		page = 1
	}
	ch := make(chan map[string]any, 1)
	pm.mu.Lock()
	pm.ladderCh = ch
	pm.mu.Unlock()
	defer func() {
		pm.mu.Lock()
		if pm.ladderCh == ch {
			pm.ladderCh = nil
		}
		pm.mu.Unlock()
	}()
	if err := pm.sendFn(ctx, map[string]any{"t": "pvp.tabela", "pagina": page}); err != nil {
		return nil, err
	}
	select {
	case res := <-ch:
		return res, nil
	case <-time.After(10 * time.Second):
		return nil, errors.New("timeout carregando ranking semanal")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (pm *PvpManager) RequestMonthly(ctx context.Context, page int) (map[string]any, error) {
	if page < 0 {
		page = 0
	}
	ch := make(chan map[string]any, 1)
	pm.mu.Lock()
	pm.monthlyCh = ch
	pm.mu.Unlock()
	defer func() {
		pm.mu.Lock()
		if pm.monthlyCh == ch {
			pm.monthlyCh = nil
		}
		pm.mu.Unlock()
	}()
	if err := pm.sendFn(ctx, map[string]any{"t": "pvp.mensal", "pagina": page}); err != nil {
		return nil, err
	}
	select {
	case res := <-ch:
		return res, nil
	case <-time.After(10 * time.Second):
		return nil, errors.New("timeout carregando ranking mensal")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Tick runs once per second while account is ONLINE.
func (pm *PvpManager) Tick(ctx context.Context, level int) {
	now := time.Now()
	pm.mu.Lock()
	needInfo := pm.lastInfo.IsZero() || now.Sub(pm.lastInfo) >= pvpInfoInterval
	auto := pm.auto
	nativeAuto := pm.nativeAuto
	inQueue := pm.inQueue
	pending := pm.pendingEnter
	waitUntil := pm.waitUntil
	lastEnter := pm.lastEnter
	teamLen := len(pm.team)
	minLv := pvpLevelMin
	if rMin := asInt(pm.rules["nivelMin"]); rMin > 0 {
		minLv = rMin
	}
	pm.mu.Unlock()

	if needInfo {
		_ = pm.RequestInfo(ctx)
		return
	}
	if !auto || nativeAuto || inQueue || level < minLv || teamLen == 0 {
		return
	}
	if now.Before(waitUntil) || now.Sub(lastEnter) < pvpEnterGap {
		return
	}
	if pending && now.Sub(lastEnter) < pvpConfirmWait {
		return
	}
	_ = pm.EnterQueue(ctx)
}

func (pm *PvpManager) View(accID int, nick string, level int, online bool) PvpAccountView {
	pm.mu.Lock()
	defer pm.mu.Unlock()
	waitSec := 0
	if !pm.waitUntil.IsZero() && time.Now().Before(pm.waitUntil) {
		waitSec = int(time.Until(pm.waitUntil).Seconds())
	}
	houses := make(map[string]int, len(pm.houses))
	for k, v := range pm.houses {
		houses[k] = v
	}
	team := make([]int, len(pm.team))
	copy(team, pm.team)
	matches := make([]PvpMatchEntry, len(pm.matches))
	copy(matches, pm.matches)
	return PvpAccountView{
		AccountID:     accID,
		Nick:          nick,
		Level:         level,
		Online:        online,
		Auto:          pm.auto,
		NativeAuto:    pm.nativeAuto,
		InQueue:       pm.inQueue,
		QueueSize:     pm.queueSize,
		WaitSec:       waitSec,
		Position:      pm.position,
		FinalPosition: pm.finalPosition,
		FinalCut:      pm.finalCut,
		TotalRanked:   pm.totalRanked,
		Rank:          deepCloneMap(pm.rank),
		Team:          team,
		Houses:        houses,
		Wins:          pm.wins,
		Losses:        pm.losses,
		Delta:         pm.delta,
		Refusal:       pm.refusal,
		Matches:       matches,
	}
}
