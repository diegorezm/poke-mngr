package pokeidle

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/coder/websocket"

	"poke-mngr/internal/config"
	"poke-mngr/internal/store"
)

type errAccountBlocked struct {
	kind   string
	detail string
}

func (e errAccountBlocked) Error() string { return e.detail }

type errExternalLogin struct {
	code websocket.StatusCode
}

func (e errExternalLogin) Error() string {
	return fmt.Sprintf("login externo detectado (code %d)", e.code)
}

type errNetworkFull struct{}

func (e errNetworkFull) Error() string { return "rede no limite de contas online" }

type AccountConnection struct {
	mu         sync.RWMutex
	acc        config.AccountRecord
	wsURL      string
	waitMin    int
	downSec    int
	reportHour int
	reportTZ   string

	store    *store.Store
	notifier *Notifier
	catalog  *ItemCatalog
	bridge   *BridgeHub
	official *OfficialStreamers

	state         ConnectionState
	block         *BlockInfo
	lastReason    string
	cooldownUntil time.Time
	exitIP        string
	wasOnline     bool
	downSince     time.Time
	downAlerted   bool
	downReason    string
	downTimer     *time.Timer
	stopped       bool
	onlineSince   time.Time
	lastFrameAt   time.Time
	serverOffset  int64 // servidorAgora - localNowMs

	// Active WebSocket + write lock
	wsMu sync.Mutex
	ws   *websocket.Conn

	// Cached bootstrap frames for Caminho 1 Bridge replay
	welcomeTemplate map[string]any
	lastCampoInit   []byte
	lastCampo       []byte

	// Game state & automations
	hunt         *HuntManager
	balls        *BallManager
	shop         *ShopManager
	market       *MarketClient
	pvp          *PvpManager
	session      *SessionItems
	shinies      *ShinyTracker
	sessionStart int64
	pendingHunt string
	hunts       []any
	outlandTiers []any
	itensNossos map[int]map[string]any
	mercadoCfg  map[string]any

	// External callbacks
	onStateChange func()
	onOnline      func(ctx context.Context, conn *AccountConnection)
	onChatFrame   func(accID int, frame map[string]any)
	onMarketFrame func(accID int, frame map[string]any)
	onPvpFrame    func(accID int, frame map[string]any)
	onFichaFrame  func(accID int, frame map[string]any)

	cancel context.CancelFunc
	done   chan struct{}
}

func NewAccountConnection(
	acc config.AccountRecord,
	gs config.GlobalSettings,
	st *store.Store,
	notifier *Notifier,
	catalog *ItemCatalog,
	bridge *BridgeHub,
	official *OfficialStreamers,
) *AccountConnection {
	ac := &AccountConnection{
		acc:         acc,
		wsURL:       gs.WSURL,
		waitMin:     gs.ExternalLoginWaitMin,
		downSec:     gs.DownAlertDelaySec,
		reportHour:  gs.DailyReportHour,
		reportTZ:    gs.ReportTZ,
		store:       st,
		notifier:    notifier,
		catalog:     catalog,
		bridge:      bridge,
		official:    official,
		state:       StateDisconnected,
		exitIP:      "?",
		hunt:        NewHuntManager(),
		balls:       NewBallManager(acc.Options.BallPriority),
		shop:        NewShopManager(),
		itensNossos: map[int]map[string]any{},
		done:        make(chan struct{}),
	}

	if snap, err := st.LoadSessionState(acc.ID); err == nil && snap != nil {
		ac.sessionStart = snap.StartedAt
		ac.session = NewSessionItems(snap.Gained)
		ac.shinies = NewShinyTracker(snap.Shinies.Seen, snap.Shinies.Captured)
	} else {
		ac.session = NewSessionItems(nil)
		ac.shinies = NewShinyTracker(0, 0)
	}

	ac.market = NewMarketClient(acc.Name(), ac.sendJSON)
	ac.pvp = NewPvpManager(acc.Name(), acc.Options.PvpAuto, ac.sendJSON)

	return ac
}

func (ac *AccountConnection) Start(parent context.Context) {
	ctx, cancel := context.WithCancel(parent)
	ac.mu.Lock()
	ac.cancel = cancel
	ac.mu.Unlock()
	go ac.runForever(ctx)
}

func (ac *AccountConnection) Stop() {
	ac.mu.Lock()
	ac.stopped = true
	ac.cancelDownTimerLocked()
	cancel := ac.cancel
	ac.mu.Unlock()
	if cancel == nil {
		return
	}
	cancel()
	select {
	case <-ac.done:
	case <-time.After(5 * time.Second):
		log.Printf("[%s] timeout aguardando encerramento da conexão", ac.acc.Name())
	}
}

func (ac *AccountConnection) UpdateSettings(gs config.GlobalSettings) {
	ac.mu.Lock()
	ac.wsURL = gs.WSURL
	ac.waitMin = gs.ExternalLoginWaitMin
	ac.downSec = gs.DownAlertDelaySec
	ac.reportHour = gs.DailyReportHour
	ac.reportTZ = gs.ReportTZ
	ac.mu.Unlock()
}

func (ac *AccountConnection) cancelDownTimerLocked() {
	if ac.downTimer != nil {
		ac.downTimer.Stop()
		ac.downTimer = nil
	}
}

func (ac *AccountConnection) scheduleDisconnectAlert(reason string) {
	var immediate *DiscordEmbed

	ac.mu.Lock()
	if !ac.wasOnline || ac.stopped || ac.downAlerted {
		ac.mu.Unlock()
		return
	}
	if ac.downSince.IsZero() {
		ac.downSince = time.Now()
	}
	ac.downReason = reason
	if ac.downSec <= 0 {
		ac.cancelDownTimerLocked()
		ac.downAlerted = true
		motivo := reason
		if motivo == "" {
			motivo = "queda de conexão"
		}
		immediate = &DiscordEmbed{
			Title:       ac.acc.Nick,
			Description: "🔴 Caiu.",
			Color:       ColorRed,
			Fields: []DiscordEmbedField{
				{Name: "Motivo", Value: motivo, Inline: false},
			},
		}
	} else if ac.downTimer == nil {
		delay := time.Duration(ac.downSec) * time.Second
		ac.downTimer = time.AfterFunc(delay, ac.fireDownAlert)
	}
	ac.mu.Unlock()

	if immediate != nil {
		ac.notifier.Send(*immediate)
	}
}

func (ac *AccountConnection) fireDownAlert() {
	ac.mu.Lock()
	ac.downTimer = nil
	if ac.stopped || ac.downAlerted || !ac.wasOnline || ac.state == StateOnline {
		ac.mu.Unlock()
		return
	}
	ac.downAlerted = true
	nick := ac.acc.Nick
	motivo := ac.downReason
	if motivo == "" {
		motivo = "queda de conexão"
	}
	ac.mu.Unlock()

	ac.notifier.Send(DiscordEmbed{
		Title:       nick,
		Description: "🔴 Caiu.",
		Color:       ColorRed,
		Fields: []DiscordEmbedField{
			{Name: "Motivo", Value: motivo, Inline: false},
		},
	})
}

func (ac *AccountConnection) UpdateOptions(opts config.AccountOptions) {
	ac.mu.Lock()
	ac.acc.Options = opts
	ac.balls.SetPriority(opts.BallPriority)
	ac.pvp.SetAuto(opts.PvpAuto)
	ac.mu.Unlock()
}

func (ac *AccountConnection) Pvp() *PvpManager {
	return ac.pvp
}

func (ac *AccountConnection) Market() *MarketClient {
	return ac.market
}

func (ac *AccountConnection) Account() config.AccountRecord {
	ac.mu.RLock()
	defer ac.mu.RUnlock()
	return ac.acc
}

func (ac *AccountConnection) IsOnline() bool {
	ac.mu.RLock()
	online := ac.state == StateOnline
	ac.mu.RUnlock()
	return online
}

func (ac *AccountConnection) ServerNowMs() int64 {
	ac.mu.RLock()
	off := ac.serverOffset
	ac.mu.RUnlock()
	return time.Now().UnixMilli() + off
}

func (ac *AccountConnection) sendJSON(ctx context.Context, payload any) error {
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return ac.sendRaw(ctx, b)
}

func (ac *AccountConnection) sendRaw(ctx context.Context, data []byte) error {
	ac.wsMu.Lock()
	ws := ac.ws
	ac.wsMu.Unlock()
	if ws == nil {
		return errors.New("conta offline")
	}
	wctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return ws.Write(wctx, websocket.MessageText, data)
}

// ForwardFromBridge sends a frame originating in the embedded pokeidle.io/app WebView
// upstream to the real PokéIdle server.
func (ac *AccountConnection) ForwardFromBridge(ctx context.Context, frameType string, raw []byte) error {
	if frameType == "ball.throw" {
		var m map[string]any
		if json.Unmarshal(raw, &m) == nil && m["slot"] != nil {
			ac.balls.MarkThrown(asInt(m["slot"]))
		}
	}
	return ac.sendRaw(ctx, raw)
}

// BuildBridgeReplayFrames synthesizes an up-to-date `welcome` + `campo.init` sequence
// so an embedded pokeidle.io/app WebView can attach mid-session without disconnecting the upstream WS.
func (ac *AccountConnection) BuildBridgeReplayFrames() [][]byte {
	ac.mu.RLock()
	defer ac.mu.RUnlock()

	var frames [][]byte
	if ac.welcomeTemplate != nil {
		snap := deepCloneMap(ac.welcomeTemplate)
		snap["estado"] = deepCloneMap(ac.hunt.Estado)
		if b, err := json.Marshal(snap); err == nil {
			frames = append(frames, b)
		}
	}
	if len(ac.lastCampoInit) > 0 {
		cp := make([]byte, len(ac.lastCampoInit))
		copy(cp, ac.lastCampoInit)
		frames = append(frames, cp)
	}
	if len(ac.lastCampo) > 0 {
		cp := make([]byte, len(ac.lastCampo))
		copy(cp, ac.lastCampo)
		frames = append(frames, cp)
	}
	return frames
}

// --- Core Connection Loop ---

func (ac *AccountConnection) runForever(ctx context.Context) {
	defer close(ac.done)
	defer ac.setState(StateDisconnected, "")

	for {
		if ctx.Err() != nil {
			return
		}
		ac.mu.RLock()
		enabled := ac.acc.Enabled
		directMode := ac.acc.Options.DirectMode
		ac.mu.RUnlock()
		if !enabled || directMode {
			ac.setState(StateDisconnected, "")
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
				continue
			}
		}

		// Probe exit IP (best-effort)
		ac.probeIP(ctx)

		start := time.Now()
		err := ac.connectOnce(ctx)
		if ctx.Err() != nil {
			return
		}

		var blk errAccountBlocked
		if errors.As(err, &blk) {
			ac.mu.Lock()
			ac.state = StateBlocked
			ac.block = &BlockInfo{Kind: blk.kind, Detail: blk.detail}
			ac.lastReason = blk.detail
			ac.cancelDownTimerLocked()
			if ac.wasOnline {
				if ac.downSince.IsZero() {
					ac.downSince = time.Now()
				}
				ac.downAlerted = true
			}
			ac.mu.Unlock()
			_ = ac.store.UpdateAccountAuthStatus(ac.acc.ID, blk.kind, blk.detail)
			ac.notifier.Send(DiscordEmbed{
				Title:       fmt.Sprintf("⚠️ %s — Ação necessária", ac.acc.Nick),
				Description: blk.detail,
				Color:       ColorRed,
			})
			ac.emitChange()
			// Halt reconnect until user edits/restarts the account (which cancels ctx)
			<-ctx.Done()
			return
		}

		var ext errExternalLogin
		if errors.As(err, &ext) {
			ac.mu.RLock()
			wait := time.Duration(ac.waitMin) * time.Minute
			if wait < time.Minute {
				wait = config.CooldownDefault
			}
			ac.mu.RUnlock()
			reason := fmt.Sprintf("Login externo detectado (code %d) — aguardando %d min", ext.code, int(wait.Minutes()))
			var pauseAlert *DiscordEmbed
			ac.mu.Lock()
			ac.state = StatePausedCooldown
			ac.cooldownUntil = time.Now().Add(wait)
			ac.lastReason = reason
			if ac.wasOnline && !ac.stopped {
				ac.cancelDownTimerLocked()
				if ac.downSince.IsZero() {
					ac.downSince = time.Now()
				}
				if !ac.downAlerted {
					ac.downAlerted = true
					pauseAlert = &DiscordEmbed{
						Title:       ac.acc.Nick,
						Description: "🔴 Caiu (login externo).",
						Color:       ColorRed,
						Fields: []DiscordEmbedField{
							{Name: "Motivo", Value: reason, Inline: false},
						},
					}
				}
			}
			ac.mu.Unlock()
			if pauseAlert != nil {
				ac.notifier.Send(*pauseAlert)
			}
			ac.emitChange()
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
				continue
			}
		}

		var nf errNetworkFull
		if errors.As(err, &nf) {
			nfReason := "Rede no limite de 4 contas online; tentando novamente em 30s"
			ac.setState(StateDisconnected, nfReason)
			ac.scheduleDisconnectAlert(nfReason)
			select {
			case <-ctx.Done():
				return
			case <-time.After(config.NetworkFullRetry):
				continue
			}
		}

		reason := friendlyReason(err)
		ac.setState(StateDisconnected, reason)
		ac.scheduleDisconnectAlert(reason)
		delay := config.ReconnectDelay
		if time.Since(start) >= config.MinUptimeFast {
			delay = 0
		}
		if delay > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
		}
	}
}

func (ac *AccountConnection) probeIP(ctx context.Context) {
	ac.mu.RLock()
	p := ac.acc.Proxy
	ac.mu.RUnlock()
	pctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if ip, err := ProbeExitIP(pctx, p); err == nil && ip != "" {
		ac.mu.Lock()
		ac.exitIP = ip
		ac.mu.Unlock()
	}
}

func (ac *AccountConnection) connectOnce(ctx context.Context) error {
	ac.setState(StateConnecting, "")

	ac.mu.RLock()
	acc := ac.acc
	wsURL := ac.wsURL
	ac.mu.RUnlock()

	httpClient, err := BuildHTTPClient(acc.Proxy, 20*time.Second)
	if err != nil {
		return err
	}
	defer httpClient.CloseIdleConnections()
	dialCtx, dialCancel := context.WithTimeout(ctx, 20*time.Second)
	ws, resp, err := websocket.Dial(dialCtx, wsURL, &websocket.DialOptions{
		HTTPClient: httpClient,
	})
	dialCancel()
	if err != nil {
		if resp != nil && (resp.StatusCode == 401 || resp.StatusCode == 403) {
			return errExternalLogin{code: websocket.StatusCode(resp.StatusCode)}
		}
		return err
	}
	ws.SetReadLimit(32 << 20)

	ac.wsMu.Lock()
	ac.ws = ws
	ac.wsMu.Unlock()
	defer func() {
		ac.wsMu.Lock()
		ac.ws = nil
		ac.wsMu.Unlock()
		if ctx.Err() != nil {
			_ = ws.CloseNow()
		} else {
			_ = ws.Close(websocket.StatusNormalClosure, "bye")
		}
		ac.balls.Reset()
		ac.shop.Reset()
		ac.market.Reset("conta offline")
	}()

	ac.setState(StateAuthenticating, "")
	hello := map[string]any{
		"t":           "hello",
		"nick":        acc.Nick,
		"token":       acc.Token,
		"delta":       1,
		"dispositivo": acc.DeviceID,
	}
	if err := ac.sendJSON(ctx, hello); err != nil {
		return err
	}

	// Wait for welcome
	welcomeCtx, welcomeCancel := context.WithTimeout(ctx, config.WelcomeTimeout)
	welcomed := false
	for !welcomed {
		_, raw, err := ws.Read(welcomeCtx)
		if err != nil {
			welcomeCancel()
			return classifyCloseError(err)
		}
		var msg map[string]any
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		switch asString(msg["t"]) {
		case "welcome":
			ac.handleWelcome(msg)
			if ac.bridge != nil {
				ac.bridge.BroadcastServerFrame(acc.ID, raw)
			}
			welcomed = true
		case "erro":
			welcomeCancel()
			if blk := classifyErroFrame(msg); blk != nil {
				return blk
			}
		}
	}
	welcomeCancel()

	// Ensure item catalog loaded for restock calculations
	go ac.catalog.EnsureLoaded(ctx)

	sessCtx, sessCancel := context.WithCancel(ctx)
	defer sessCancel()

	var recoveryAlert *DiscordEmbed
	var sessionSnap *store.SessionSnapshot
	ac.mu.Lock()
	ac.state = StateOnline
	ac.block = nil
	ac.lastReason = ""
	ac.cooldownUntil = time.Time{}
	ac.onlineSince = time.Now()
	ac.lastFrameAt = time.Now()
	if ac.sessionStart == 0 {
		ac.sessionStart = time.Now().Unix()
		snap := ac.sessionSnapshotLocked()
		sessionSnap = &snap
	}
	ac.cancelDownTimerLocked()
	if ac.downAlerted && !ac.downSince.IsZero() {
		downtime := time.Since(ac.downSince)
		recoveryAlert = &DiscordEmbed{
			Title:       ac.acc.Nick,
			Description: "🟢 Voltou ao ar.",
			Color:       ColorGreen,
			Fields: []DiscordEmbedField{
				{Name: "Tempo fora", Value: formatDurationPT(downtime), Inline: true},
			},
		}
	}
	ac.wasOnline = true
	ac.downSince = time.Time{}
	ac.downAlerted = false
	ac.downReason = ""
	ac.mu.Unlock()
	if sessionSnap != nil {
		_ = ac.store.SaveSessionState(acc.ID, *sessionSnap)
	}
	if recoveryAlert != nil {
		ac.notifier.Send(*recoveryAlert)
	}
	_ = ac.store.UpdateAccountAuthStatus(acc.ID, "ok", "")
	ac.emitChange()

	// If configured huntSlug differs, select it
	ac.mu.RLock()
	currentHuntSlug := asString(ac.hunt.Estado["huntSlug"])
	ac.mu.RUnlock()
	if acc.Options.HuntSlug != "" && acc.Options.HuntSlug != currentHuntSlug {
		_ = ac.SelectHunt(sessCtx, acc.Options.HuntSlug)
	}

	// Background workers for this online session
	go ac.pingLoop(sessCtx, ws, sessCancel)
	go ac.watchdogLoop(sessCtx, ws, sessCancel)
	go ac.automationLoop(sessCtx)
	if ac.onOnline != nil {
		go ac.onOnline(sessCtx, ac)
	}

	// Main read loop
	for {
		_, raw, err := ws.Read(sessCtx)
		if err != nil {
			return classifyCloseError(err)
		}
		ac.mu.Lock()
		ac.lastFrameAt = time.Now()
		ac.mu.Unlock()

		var msg map[string]any
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		if stopErr := ac.handleFrame(sessCtx, msg, raw); stopErr != nil {
			return stopErr
		}
		if ac.bridge != nil {
			ac.bridge.BroadcastServerFrame(acc.ID, raw)
		}
	}
}

func (ac *AccountConnection) handleWelcome(msg map[string]any) {
	ac.mu.Lock()
	defer ac.mu.Unlock()

	ac.welcomeTemplate = deepCloneMap(msg)
	est := asMap(msg["estado"])
	if est == nil {
		est = map[string]any{}
	}
	hunts := asSlice(msg["hunts"])
	ac.hunts = hunts
	ac.outlandTiers = asSlice(msg["outlandTiers"])
	ac.mercadoCfg = asMap(msg["mercado"])
	ac.itensNossos = map[int]map[string]any{}
	for _, raw := range asSlice(msg["itensNossos"]) {
		if m := asMap(raw); m != nil {
			ac.itensNossos[asInt(m["id"])] = m
		}
	}

	if srvNow := asInt64(est["servidorAgora"]); srvNow > 0 {
		ac.serverOffset = srvNow - time.Now().UnixMilli()
		ac.market.NoteServerTime(srvNow)
	}
	ac.hunt.OnWelcome(est, hunts)
	ac.pvp.ResetConnection(ac.hunt.Estado)
	ac.session.ResetBaseline(ac.hunt.Estado)
	if ac.official != nil {
		ac.official.UpdateFromEstado(ac.hunt.Estado)
	}
}

func (ac *AccountConnection) handleFrame(ctx context.Context, msg map[string]any, raw []byte) error {
	t := asString(msg["t"])
	switch t {
	case "sessao.renovada":
		if newTok := asString(msg["token"]); newTok != "" {
			ac.mu.Lock()
			ac.acc.Token = newTok
			accID := ac.acc.ID
			ac.mu.Unlock()
			_ = ac.store.UpdateAccountToken(accID, newTok)
			log.Printf("[%s] token renovado automaticamente", ac.acc.Name())
		}

	case "erro":
		if blk := classifyErroFrame(msg); blk != nil {
			return blk
		}
		ac.shop.HandleError(asString(msg["msg"]))
		ac.market.HandleFrame(msg)

	case "estado":
		patch := asMap(msg["estado"])
		if patch == nil {
			return nil
		}
		var (
			sessionSnap *store.SessionSnapshot
			accID       int
			nick        string
			reportHour  int
			reportTZ    string
		)
		ac.mu.Lock()
		if srvNow := asInt64(patch["servidorAgora"]); srvNow > 0 {
			ac.serverOffset = srvNow - time.Now().UnixMilli()
			ac.market.NoteServerTime(srvNow)
		}
		ac.hunt.HandleEstadoPatch(patch)
		ac.pvp.HandleEstado(patch)
		deltas := ac.session.Update(ac.hunt.Estado)
		if len(deltas) > 0 {
			snap := ac.sessionSnapshotLocked()
			sessionSnap = &snap
			accID = ac.acc.ID
			nick = ac.acc.Nick
			reportHour = ac.reportHour
			reportTZ = ac.reportTZ
		}
		if ac.official != nil && (patch["twitch"] != nil || patch["kick"] != nil) {
			ac.official.UpdateFromEstado(ac.hunt.Estado)
		}
		ac.mu.Unlock()

		if sessionSnap != nil {
			_ = ac.store.SaveSessionState(accID, *sessionSnap)
			period := CurrentDailyPeriod(time.Now(), reportHour, reportTZ)
			for k, d := range deltas {
				_ = ac.store.AddDailyRareItem(period, nick, k, d)
				ac.notifier.Send(DiscordEmbed{
					Title:       fmt.Sprintf("✨ Drop Raro — %s", nick),
					Description: fmt.Sprintf("**+%d %s**", d, RareLabels[k]),
					Color:       ColorGold,
				})
			}
		}

	case "campo.init":
		cp := make([]byte, len(raw))
		copy(cp, raw)
		ac.mu.Lock()
		ac.lastCampoInit = cp
		ac.lastCampo = nil
		ac.mu.Unlock()

	case "campo":
		cp := make([]byte, len(raw))
		copy(cp, raw)
		ac.mu.Lock()
		ac.lastCampo = cp
		ac.mu.Unlock()

	case "batalha":
		for _, evRaw := range asSlice(msg["ev"]) {
			ev := asMap(evRaw)
			if ev == nil {
				continue
			}
			var (
				sessionSnap *store.SessionSnapshot
				shinyAlert  *DiscordEmbed
				accID       int
				nick        string
				reportHour  int
				reportTZ    string
			)
			ac.mu.Lock()
			killXP, killGold, killed := ac.hunt.HandleBattleEvent(ev)
			seen, caught := ac.shinies.Handle(ev)
			if killed || seen || caught {
				accID = ac.acc.ID
				nick = ac.acc.Nick
				reportHour = ac.reportHour
				reportTZ = ac.reportTZ
			}
			if seen || caught {
				snap := ac.sessionSnapshotLocked()
				sessionSnap = &snap
				nome := asString(ev["nome"])
				if caught {
					shinyAlert = &DiscordEmbed{
						Title:       fmt.Sprintf("🌟 SHINY CAPTURADO — %s", nick),
						Description: fmt.Sprintf("Capturou **Shiny %s**!", nome),
						Color:       ColorGreen,
					}
				} else if seen {
					shinyAlert = &DiscordEmbed{
						Title:       fmt.Sprintf("✨ Shiny encontrado — %s", nick),
						Description: fmt.Sprintf("Encontrou **Shiny %s**!", nome),
						Color:       ColorGold,
					}
				}
			}
			ac.mu.Unlock()

			if killed {
				period := CurrentDailyPeriod(time.Now(), reportHour, reportTZ)
				_ = ac.store.AddDailyKill(period, nick, killXP, killGold)
			}
			if sessionSnap != nil {
				_ = ac.store.SaveSessionState(accID, *sessionSnap)
			}
			if shinyAlert != nil {
				ac.notifier.Send(*shinyAlert)
			}
			ac.balls.HandleBattleEvent(ev)
			ac.shop.HandleBattleEvent(ev)
		}
		ac.market.HandleFrame(msg)

	case "chat", "chat.historico", "chat.del", "chat.mute", "chat.aviso":
		if ac.onChatFrame != nil {
			ac.onChatFrame(ac.acc.ID, msg)
		}
	case "market", "orbs":
		ac.market.HandleFrame(msg)
		if ac.onMarketFrame != nil {
			ac.onMarketFrame(ac.acc.ID, msg)
		}
	case "pvp", "pvpTabela", "pvpMensal":
		ac.pvp.HandleFrame(ctx, msg)
		if ac.onPvpFrame != nil {
			ac.onPvpFrame(ac.acc.ID, msg)
		}
	case "ranking.ficha":
		if ac.onFichaFrame != nil {
			ac.onFichaFrame(ac.acc.ID, msg)
		}
	}
	return nil
}

func (ac *AccountConnection) pingLoop(ctx context.Context, ws *websocket.Conn, cancel context.CancelFunc) {
	ticker := time.NewTicker(config.PingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pctx, pcancel := context.WithTimeout(ctx, config.PingTimeout)
			err := ws.Ping(pctx)
			pcancel()
			if err != nil {
				cancel()
				return
			}
		}
	}
}

func (ac *AccountConnection) watchdogLoop(ctx context.Context, ws *websocket.Conn, cancel context.CancelFunc) {
	ticker := time.NewTicker(config.FrameCheck)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			ac.mu.RLock()
			huntSlug := asString(ac.hunt.Estado["huntSlug"])
			silence := time.Since(ac.lastFrameAt)
			ac.mu.RUnlock()
			if huntSlug != "" && silence > config.FrameSilence {
				log.Printf("[%s] sem frames há %s com hunt ativa; reconectando", ac.acc.Name(), silence.Round(time.Second))
				_ = ws.Close(4000, "frame silence watchdog")
				cancel()
				return
			}
		}
	}
}

func (ac *AccountConnection) automationLoop(ctx context.Context) {
	ballTicker := time.NewTicker(200 * time.Millisecond)
	restockTicker := time.NewTicker(config.RestockCheckEvery)
	huntQueueTicker := time.NewTicker(1 * time.Second)
	defer ballTicker.Stop()
	defer restockTicker.Stop()
	defer huntQueueTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			return

		case <-ballTicker.C:
			ac.mu.RLock()
			autoCatch := ac.acc.Options.AutoCatch
			accID := ac.acc.ID
			ac.mu.RUnlock()
			// Suppress bot auto-catch while the official WebView is attached via Bridge (prevents duplicate throws)
			if !autoCatch || (ac.bridge != nil && ac.bridge.HasAttached(accID)) {
				continue
			}
			ac.mu.RLock()
			slot, ballID, ok := ac.balls.NextThrow(ac.hunt.Estado)
			ac.mu.RUnlock()
			if ok {
				_ = ac.sendJSON(ctx, map[string]any{
					"t":      "ball.throw",
					"ballId": ballID,
					"slot":   slot,
				})
			}

		case <-restockTicker.C:
			ac.mu.RLock()
			opts := ac.acc.Options
			est := ac.hunt.Estado
			estado := map[string]any{
				"gold":       est["gold"],
				"items":      deepCloneMap(asMap(est["items"])),
				"balls":      deepCloneMap(asMap(est["balls"])),
				"automation": deepCloneMap(asMap(est["automation"])),
			}
			activePk := deepCloneMap(ac.hunt.ActivePokemon())
			ac.mu.RUnlock()
			if order := ac.shop.EvaluateRestock(opts, estado, activePk, ac.catalog); order != nil {
				_ = ac.sendJSON(ctx, map[string]any{
					"t":    "shop.buy",
					"kind": order.Kind,
					"id":   order.ID,
					"qty":  order.Qty,
				})
				if opts.Restock.PotionFirst && order.Kind == "item" && config.KnownPotionIDs[order.ID] {
					_ = ac.EquipItem(ctx, "potion", order.ID, false)
				}
			}

		case <-huntQueueTicker.C:
			ac.mu.RLock()
			pending := ac.pendingHunt
			lockUntil := asInt64(ac.hunt.Estado["centroLivreEm"])
			srvNow := time.Now().UnixMilli() + ac.serverOffset
			lv := asInt(ac.hunt.Estado["level"])
			ac.mu.RUnlock()
			ac.pvp.Tick(ctx, lv)
			if pending != "" && srvNow >= lockUntil {
				ac.mu.Lock()
				slug := ac.pendingHunt
				ac.pendingHunt = ""
				ac.mu.Unlock()
				if slug != "" {
					_ = ac.sendJSON(ctx, map[string]any{"t": "hunt.select", "slug": slug})
				}
			}
		}
	}
}

// --- Live Account Actions ---

func (ac *AccountConnection) SelectHunt(ctx context.Context, slug string) error {
	ac.mu.Lock()
	lockUntil := asInt64(ac.hunt.Estado["centroLivreEm"])
	srvNow := time.Now().UnixMilli() + ac.serverOffset
	if lockUntil > srvNow {
		ac.pendingHunt = slug
		ac.mu.Unlock()
		ac.emitChange()
		return nil
	}
	ac.pendingHunt = ""
	ac.mu.Unlock()
	return ac.sendJSON(ctx, map[string]any{"t": "hunt.select", "slug": slug})
}

func (ac *AccountConnection) CancelPendingHunt() {
	ac.mu.Lock()
	ac.pendingHunt = ""
	ac.mu.Unlock()
	ac.emitChange()
}

func (ac *AccountConnection) SelectOutlandTier(ctx context.Context, tier int) error {
	if tier < 1 || tier > 8 {
		return fmt.Errorf("tier inválido: %d", tier)
	}
	return ac.sendJSON(ctx, map[string]any{"t": "outland.tier", "tier": tier})
}

func (ac *AccountConnection) ClaimPass(ctx context.Context) error {
	return ac.sendJSON(ctx, map[string]any{"t": "passe.resgatar"})
}

func (ac *AccountConnection) SellDepot(ctx context.Context) (*SellResult, error) {
	ch, err := ac.shop.BeginSell()
	if err != nil {
		return nil, err
	}
	if err := ac.sendJSON(ctx, map[string]any{"t": "shop.sellAllPokemons"}); err != nil {
		ac.shop.CancelSell(ch)
		return nil, err
	}
	timer := time.NewTimer(config.SellConfirmTimeout)
	defer timer.Stop()
	select {
	case res, ok := <-ch:
		if !ok {
			return nil, errors.New("conexão reiniciada antes da confirmação")
		}
		return &res, nil
	case <-timer.C:
		ac.shop.CancelSell(ch)
		return nil, errors.New("sem confirmação do servidor (timeout)")
	case <-ctx.Done():
		ac.shop.CancelSell(ch)
		return nil, ctx.Err()
	}
}

// EquipItem updates estado.automation (ballIds or potionIds) via `auto.set`,
// and optionally buys a batch immediately if stock == 0.
func (ac *AccountConnection) EquipItem(ctx context.Context, kind string, id int, buyIfEmpty bool) error {
	ac.mu.RLock()
	auto := deepCloneMap(asMap(ac.hunt.Estado["automation"]))
	var stock int
	if kind == "ball" {
		stock = mapIntValue(asMap(ac.hunt.Estado["balls"]), id)
	} else {
		stock = mapIntValue(asMap(ac.hunt.Estado["items"]), id)
	}
	qty := ac.acc.Options.PotionRestockQty
	if kind == "ball" {
		qty = ac.acc.Options.BallRestockQty
	}
	if qty <= 0 {
		qty = 100
	}
	ac.mu.RUnlock()

	if kind == "ball" {
		ids := []int{id}
		for _, prev := range asIntSlice(auto["ballIds"]) {
			if prev != id {
				ids = append(ids, prev)
			}
		}
		auto["ballIds"] = ids
	} else {
		ids := []int{id}
		for _, prev := range asIntSlice(auto["potionIds"]) {
			if prev != id {
				ids = append(ids, prev)
			}
		}
		auto["potionIds"] = ids
	}
	payload := deepCloneMap(auto)
	payload["t"] = "auto.set"
	if err := ac.sendJSON(ctx, payload); err != nil {
		return err
	}
	if buyIfEmpty && stock <= 0 && ((kind == "ball" && config.BuyableBallIDs[id]) || (kind == "potion" && config.KnownPotionIDs[id])) {
		shopKind := "item"
		if kind == "ball" {
			shopKind = "ball"
		}
		if ac.shop.BeginBuy(shopKind, id) {
			_ = ac.sendJSON(ctx, map[string]any{"t": "shop.buy", "kind": shopKind, "id": id, "qty": qty})
		}
	}
	return nil
}

func (ac *AccountConnection) ResetSession() {
	ac.mu.Lock()
	ac.sessionStart = time.Now().Unix()
	ac.session.Clear()
	ac.shinies.Clear()
	accID := ac.acc.ID
	snap := ac.sessionSnapshotLocked()
	ac.mu.Unlock()
	_ = ac.store.SaveSessionState(accID, snap)
	ac.emitChange()
}

func (ac *AccountConnection) sessionSnapshotLocked() store.SessionSnapshot {
	return store.SessionSnapshot{
		StartedAt: ac.sessionStart,
		Gained:    ac.session.Snapshot(),
		Shinies: store.ShinyCounts{
			Seen:     ac.shinies.Seen,
			Captured: ac.shinies.Captured,
		},
	}
}

func (ac *AccountConnection) setState(st ConnectionState, reason string) {
	ac.mu.Lock()
	ac.state = st
	if reason != "" {
		ac.lastReason = reason
	}
	ac.mu.Unlock()
	ac.emitChange()
}

func (ac *AccountConnection) emitChange() {
	if ac.onStateChange != nil {
		ac.onStateChange()
	}
}

// Snapshot builds the AccountTelemetry payload pushed to the frontend.
func (ac *AccountConnection) Snapshot() AccountTelemetry {
	ac.mu.RLock()
	defer ac.mu.RUnlock()

	est := ac.hunt.Estado
	activePk := ac.hunt.ActivePokemon()
	activeSummary := ac.hunt.ActivePokemonSummary()

	potID := resolveEquippedPotionID(est, activePk, ac.acc.Options.PotionID, ac.catalog)
	var eqPotion *EquippedItem
	if potID > 0 {
		name := PotionNames[potID]
		if name == "" {
			name = fmt.Sprintf("Potion #%d", potID)
		}
		eqPotion = &EquippedItem{
			ID:    potID,
			Name:  name,
			Stock: mapIntValue(asMap(est["items"]), potID),
		}
	}

	ballID := resolveEquippedBallID(est, ac.acc.Options.BallPriority, ac.acc.Options.BallID)
	var eqBall *EquippedItem
	if ballID > 0 {
		name := BallNames[ballID]
		if name == "" {
			name = fmt.Sprintf("Ball #%d", ballID)
		}
		eqBall = &EquippedItem{
			ID:    ballID,
			Name:  name,
			Stock: mapIntValue(asMap(est["balls"]), ballID),
		}
	}

	slug := asString(est["huntSlug"])
	isOutland, knownOutland := HuntIsOutland(ac.hunts, slug)
	var ht HuntTelemetry
	ht.Slug = slug
	ht.Name = ac.hunt.huntName(slug)
	ht.PendingSlug = ac.pendingHunt
	ht.OutlandTier = asInt(est["outlandTier"])
	ht.IsOutland = isOutland
	if lock := asInt64(est["centroLivreEm"]); lock > 0 {
		srvNow := time.Now().UnixMilli() + ac.serverOffset
		if lock > srvNow {
			ht.CombatLockMs = lock - srvNow
		}
	}
	if ac.hunt.Session != nil {
		ht.ElapsedSec = int64(time.Since(ac.hunt.Session.StartedAt).Seconds())
		ht.Kills = ac.hunt.Session.Kills
		ht.KillsPerHour = ac.hunt.Session.KillsPerHour()
		ht.XPPerHour = ac.hunt.Session.XPPerHour()
		ht.GoldPerHour = ac.hunt.Session.GoldPerHour()
		ht.XPGained = ac.hunt.Session.XPGained
		ht.GoldGained = ac.hunt.Session.GoldGained
	}

	level := asInt(est["level"])
	srvNow := time.Now().UnixMilli() + ac.serverOffset
	passe := asMap(est["passe"])

	var proxyLabel string
	if ac.acc.Proxy != nil && ac.acc.Proxy.Active() {
		proxyLabel = ac.acc.Proxy.Label()
	}

	var cooldownUntil int64
	if !ac.cooldownUntil.IsZero() && time.Now().Before(ac.cooldownUntil) {
		cooldownUntil = ac.cooldownUntil.UnixMilli()
	}

	pks := asSlice(est["pokemons"])
	dex := asMap(est["pokedex"])
	bridgeAttached := ac.bridge != nil && ac.bridge.HasAttached(ac.acc.ID)
	ballsCaught, ballsFailed := ac.balls.Stats()

	return AccountTelemetry{
		ID:             ac.acc.ID,
		UUID:           ac.acc.UUID,
		Nick:           ac.acc.Nick,
		Enabled:        ac.acc.Enabled,
		OrderIndex:     ac.acc.OrderIndex,
		State:          ac.state,
		Block:          ac.block,
		LastReason:     ac.lastReason,
		CooldownUntil:  cooldownUntil,
		ExitIP:         ac.exitIP,
		ProxyLabel:     proxyLabel,
		BridgeAttached: bridgeAttached,
		DirectMode:     ac.acc.Options.DirectMode,
		Level:          level,
		XP:             asInt64(est["xp"]),
		XPLevel:        asInt64(est["xpNivel"]),
		XPNext:         asInt64(est["xpProximo"]),
		Gold:           asInt64(est["gold"]),
		Orbs:           asInt64(est["orbs"]),
		Diamonds:       asInt64(est["diamonds"]),
		ActivePokemon:  activeSummary,
		EquippedPotion: eqPotion,
		EquippedBall:   eqBall,
		Hunt:           ht,
		BallsCaught:    ballsCaught,
		BallsFailed:    ballsFailed,
		PokemonCount:   len(pks),
		PokedexCount:   len(dex),
		Session: SessionTelemetry{
			StartedAt:     ac.sessionStart,
			Gained:        ac.session.Snapshot(),
			ShiniesSeen:   ac.shinies.Seen,
			ShiniesCaught: ac.shinies.Captured,
			ShowShinies:   !knownOutland || !isOutland,
		},
		Pass: PassSnapshot{
			CanClaim: CanClaimPass(passe, level, srvNow),
			Raw:      deepCloneMap(passe),
		},
		PvpAuto:        ac.acc.Options.PvpAuto,
		ServerOffsetMs: ac.serverOffset,
		UpdatedAt:      time.Now().UnixMilli(),
	}
}

// --- Probe Account (live validation) ---

func ProbeAccount(ctx context.Context, acc config.AccountRecord, wsURL string) ProbeResult {
	if wsURL == "" {
		wsURL = config.DefaultWSURL
	}
	httpClient, err := BuildHTTPClient(acc.Proxy, 20*time.Second)
	if err != nil {
		return ProbeResult{OK: false, Kind: "network", Detail: fmt.Sprintf("Proxy inválido: %v", err)}
	}
	defer httpClient.CloseIdleConnections()
	pctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()

	ws, resp, err := websocket.Dial(pctx, wsURL, &websocket.DialOptions{HTTPClient: httpClient})
	if err != nil {
		if resp != nil {
			return ProbeResult{OK: false, Kind: "http", Detail: fmt.Sprintf("HTTP %d no upgrade", resp.StatusCode)}
		}
		return ProbeResult{OK: false, Kind: "network", Detail: fmt.Sprintf("Falha de rede/proxy: %v", err)}
	}
	defer ws.Close(websocket.StatusNormalClosure, "probe")
	ws.SetReadLimit(32 << 20)

	hello := map[string]any{
		"t":           "hello",
		"nick":        acc.Nick,
		"token":       acc.Token,
		"delta":       1,
		"dispositivo": acc.DeviceID,
	}
	b, _ := json.Marshal(hello)
	if err := ws.Write(pctx, websocket.MessageText, b); err != nil {
		return ProbeResult{OK: false, Kind: "network", Detail: err.Error()}
	}

	for {
		_, raw, err := ws.Read(pctx)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				return ProbeResult{OK: false, Kind: "timeout", Detail: "welcome não recebido em 25s"}
			}
			return ProbeResult{OK: false, Kind: "closed", Detail: fmt.Sprintf("Conexão fechada: %v", err)}
		}
		var msg map[string]any
		if json.Unmarshal(raw, &msg) != nil {
			continue
		}
		switch asString(msg["t"]) {
		case "welcome":
			est := asMap(msg["estado"])
			var hunts []string
			for _, h := range asSlice(msg["hunts"]) {
				if hm := asMap(h); hm != nil {
					if slug := asString(hm["slug"]); slug != "" {
						hunts = append(hunts, slug)
					}
				}
			}
			return ProbeResult{
				OK:    true,
				Kind:  "ok",
				Nick:  asString(est["nick"]),
				Level: asInt(est["level"]),
				Hunts: hunts,
			}
		case "erro":
			chave := asString(msg["chave"])
			if rule, ok := BlockingKeys[chave]; ok {
				detail := rule.Detail
				if m := asString(msg["motivoBan"]); m != "" {
					detail += ": " + m
				}
				return ProbeResult{OK: false, Kind: rule.Kind, Detail: detail}
			}
			if NetworkFullKeys[chave] {
				return ProbeResult{OK: false, Kind: "net_full", Detail: "Rede no limite de 4 contas online: tente em instantes"}
			}
		}
	}
}

func classifyErroFrame(msg map[string]any) error {
	chave := asString(msg["chave"])
	if rule, ok := BlockingKeys[chave]; ok {
		detail := rule.Detail
		if m := asString(msg["motivoBan"]); m != "" {
			detail += ": " + m
		}
		return errAccountBlocked{kind: rule.Kind, detail: detail}
	}
	if NetworkFullKeys[chave] {
		return errNetworkFull{}
	}
	return nil
}

func classifyCloseError(err error) error {
	code := websocket.CloseStatus(err)
	if code == 4001 || code == 4003 || code == 1008 {
		return errExternalLogin{code: code}
	}
	return err
}

func friendlyReason(err error) string {
	if err == nil {
		return "Desconectado."
	}
	code := websocket.CloseStatus(err)
	if code == 1012 {
		return "O jogo reiniciou o servidor."
	}
	if code != -1 {
		return fmt.Sprintf("Conexão encerrada pelo servidor (code %d).", code)
	}
	return "Conexão interrompida; reconectando..."
}
