package pokeidle

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"poke-mngr/internal/config"
	"poke-mngr/internal/store"
)

type AccountManager struct {
	mu       sync.RWMutex
	ctx      context.Context
	cancel   context.CancelFunc
	store    *store.Store
	settings config.GlobalSettings
	notifier  *Notifier
	catalog   *ItemCatalog
	creatures *CreatureCatalog
	sprites   *SpriteProxy
	bridge   *BridgeHub
	official *OfficialStreamers
	chat     *ChatHub
	market   *MarketService

	conns map[int]*AccountConnection

	telemetryListenersMu sync.RWMutex
	onTelemetry          func(TelemetrySnapshot)
	dirtyCh              chan struct{}
}

func NewAccountManager(st *store.Store) *AccountManager {
	gs := st.LoadGlobalSettings()
	notifier := NewNotifier(gs.DiscordWebhookURL)
	catalog := NewItemCatalog()
	creatures := NewCreatureCatalog()
	sprites := NewSpriteProxy()
	official := NewOfficialStreamers()

	mgr := &AccountManager{
		store:     st,
		settings:  gs,
		notifier:  notifier,
		catalog:   catalog,
		creatures: creatures,
		sprites:   sprites,
		official:  official,
		chat:      NewChatHub(),
		conns:     map[int]*AccountConnection{},
		dirtyCh:   make(chan struct{}, 1),
	}
	mgr.bridge = NewBridgeHub(mgr, sprites, uuid.NewString())
	mgr.market = NewMarketService(mgr, st)
	return mgr
}

func (m *AccountManager) Start(parent context.Context) error {
	ctx, cancel := context.WithCancel(parent)
	m.ctx = ctx
	m.cancel = cancel

	if _, err := m.bridge.Start(); err != nil {
		return err
	}
	go m.notifier.Run(ctx)
	go m.catalog.EnsureLoaded(ctx)
	go m.creatures.EnsureLoaded(ctx)
	go m.market.RunRuleLoop(ctx)

	accounts, err := m.store.ListAccounts()
	if err != nil {
		return err
	}
	for _, acc := range accounts {
		m.spawnLocked(acc)
	}

	go m.telemetryLoop(ctx)
	return nil
}

func (m *AccountManager) Stop() {
	if m.cancel != nil {
		m.cancel()
	}
	m.mu.Lock()
	conns := make([]*AccountConnection, 0, len(m.conns))
	for _, c := range m.conns {
		conns = append(conns, c)
	}
	m.conns = map[int]*AccountConnection{}
	m.mu.Unlock()

	for _, c := range conns {
		c.Stop()
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	m.bridge.Stop(ctx)
}

func (m *AccountManager) SetTelemetryHandler(fn func(TelemetrySnapshot)) {
	m.telemetryListenersMu.Lock()
	m.onTelemetry = fn
	m.telemetryListenersMu.Unlock()
}

func (m *AccountManager) Bridge() *BridgeHub {
	return m.bridge
}

func (m *AccountManager) Official() *OfficialStreamers {
	return m.official
}

func (m *AccountManager) Chat() *ChatHub {
	return m.chat
}

func (m *AccountManager) Market() *MarketService {
	return m.market
}

func (m *AccountManager) Store() *store.Store {
	return m.store
}

func (m *AccountManager) ListPvpViews() []PvpAccountView {
	m.mu.RLock()
	conns := make([]*AccountConnection, 0, len(m.conns))
	for _, c := range m.conns {
		conns = append(conns, c)
	}
	m.mu.RUnlock()

	sort.Slice(conns, func(i, j int) bool { return conns[i].Account().OrderIndex < conns[j].Account().OrderIndex })
	out := make([]PvpAccountView, 0, len(conns))
	for _, c := range conns {
		snap := c.Snapshot()
		out = append(out, c.pvp.View(snap.ID, snap.Nick, snap.Level, snap.State == StateOnline))
	}
	return out
}

func (m *AccountManager) SetPvpAuto(accountID int, enabled bool) error {
	acc, err := m.store.GetAccount(accountID)
	if err != nil {
		return err
	}
	acc.Options.PvpAuto = enabled
	if err := m.store.UpdateAccount(*acc); err != nil {
		return err
	}
	if c := m.GetConnection(accountID); c != nil {
		c.UpdateOptions(acc.Options)
	}
	m.notifyTelemetryDirty()
	return nil
}

func (m *AccountManager) Notifier() *Notifier {
	return m.notifier
}

func (m *AccountManager) Settings() config.GlobalSettings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.settings
}

func (m *AccountManager) UpdateSettings(gs config.GlobalSettings) error {
	if strings.TrimSpace(gs.WSURL) == "" {
		gs.WSURL = config.DefaultWSURL
	}
	if err := m.store.SaveGlobalSettings(gs); err != nil {
		return err
	}
	m.mu.Lock()
	m.settings = gs
	m.notifier.SetWebhook(gs.DiscordWebhookURL)
	for _, c := range m.conns {
		c.UpdateSettings(gs)
	}
	m.mu.Unlock()
	m.notifyTelemetryDirty()
	return nil
}

func (m *AccountManager) GetConnection(id int) *AccountConnection {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.conns[id]
}

func (m *AccountManager) ListAccountsRedacted() ([]config.AccountRecord, error) {
	accs, err := m.store.ListAccounts()
	if err != nil {
		return nil, err
	}
	out := make([]config.AccountRecord, len(accs))
	for i, a := range accs {
		out[i] = a.Redacted()
	}
	return out, nil
}

func (m *AccountManager) AddAccount(acc config.AccountRecord, skipTest bool) (config.AccountRecord, *ProbeResult, error) {
	acc.Nick = strings.TrimSpace(acc.Nick)
	acc.Token = strings.TrimSpace(acc.Token)
	acc.DeviceID = strings.TrimSpace(acc.DeviceID)
	if acc.DeviceID == "" {
		acc.DeviceID = uuid.NewString()
	}
	if acc.Nick == "" || acc.Token == "" {
		return config.AccountRecord{}, nil, fmt.Errorf("nick e token são obrigatórios")
	}

	var probe *ProbeResult
	if !skipTest {
		res := ProbeAccount(m.ctx, acc, m.Settings().WSURL)
		probe = &res
		if !res.OK {
			return config.AccountRecord{}, probe, fmt.Errorf("%s", res.Detail)
		}
		if res.Nick != "" {
			acc.Nick = res.Nick
		}
	}

	saved, err := m.store.AddAccount(acc)
	if err != nil {
		return config.AccountRecord{}, probe, err
	}
	m.mu.Lock()
	m.spawnLocked(saved)
	m.mu.Unlock()
	m.notifyTelemetryDirty()
	return saved.Redacted(), probe, nil
}

func (m *AccountManager) UpdateAccount(patch config.AccountRecord) (config.AccountRecord, error) {
	existing, err := m.store.GetAccount(patch.ID)
	if err != nil {
		return config.AccountRecord{}, err
	}
	if strings.TrimSpace(patch.Nick) != "" {
		existing.Nick = strings.TrimSpace(patch.Nick)
	}
	if strings.TrimSpace(patch.Token) != "" {
		existing.Token = strings.TrimSpace(patch.Token)
		existing.TokenStatus = "ok"
		existing.TokenDetail = ""
	}
	if strings.TrimSpace(patch.DeviceID) != "" {
		existing.DeviceID = strings.TrimSpace(patch.DeviceID)
	}
	existing.Enabled = patch.Enabled
	existing.Options = patch.Options

	if patch.Proxy != nil && patch.Proxy.Active() {
		p := *patch.Proxy
		if p.Password == "••••" && existing.Proxy != nil {
			p.Password = existing.Proxy.Password
		}
		existing.Proxy = &p
	} else {
		existing.Proxy = nil
	}

	if err := m.store.UpdateAccount(*existing); err != nil {
		return config.AccountRecord{}, err
	}
	m.restartAccount(existing.ID, *existing)
	return existing.Redacted(), nil
}

func (m *AccountManager) DeleteAccount(id int) error {
	m.mu.Lock()
	conn := m.conns[id]
	delete(m.conns, id)
	m.mu.Unlock()
	if conn != nil {
		conn.Stop()
	}
	if err := m.store.DeleteAccount(id); err != nil {
		return err
	}
	m.notifyTelemetryDirty()
	return nil
}

func (m *AccountManager) RestartAccount(id int) error {
	acc, err := m.store.GetAccount(id)
	if err != nil {
		return err
	}
	m.restartAccount(id, *acc)
	return nil
}

func (m *AccountManager) ReorderAccounts(ids []int) error {
	if err := m.store.ReorderAccounts(ids); err != nil {
		return err
	}
	m.mu.Lock()
	for idx, id := range ids {
		if c := m.conns[id]; c != nil {
			c.mu.Lock()
			c.acc.OrderIndex = idx
			c.mu.Unlock()
		}
	}
	m.mu.Unlock()
	m.notifyTelemetryDirty()
	return nil
}

func (m *AccountManager) restartAccount(id int, acc config.AccountRecord) {
	m.mu.Lock()
	old := m.conns[id]
	delete(m.conns, id)
	m.mu.Unlock()
	if old != nil {
		old.Stop()
	}
	m.mu.Lock()
	m.spawnLocked(acc)
	m.mu.Unlock()
	m.notifyTelemetryDirty()
}

func (m *AccountManager) spawnLocked(acc config.AccountRecord) {
	conn := NewAccountConnection(acc, m.settings, m.store, m.notifier, m.catalog, m.bridge, m.official)
	conn.onStateChange = m.notifyTelemetryDirty
	conn.onOnline = func(ctx context.Context, c *AccountConnection) {
		m.chat.OnAccountOnline(ctx, c)
	}
	conn.onChatFrame = func(accID int, frame map[string]any) {
		m.chat.HandleFrame(accID, acc.Nick, frame)
	}
	m.conns[acc.ID] = conn
	if m.ctx != nil {
		conn.Start(m.ctx)
	}
}

func (m *AccountManager) notifyTelemetryDirty() {
	select {
	case m.dirtyCh <- struct{}{}:
	default:
	}
}

func (m *AccountManager) Snapshot() TelemetrySnapshot {
	m.mu.RLock()
	conns := make([]*AccountConnection, 0, len(m.conns))
	for _, c := range m.conns {
		conns = append(conns, c)
	}
	m.mu.RUnlock()

	accounts := make([]AccountTelemetry, 0, len(conns))
	for _, c := range conns {
		accounts = append(accounts, c.Snapshot())
	}
	sort.Slice(accounts, func(i, j int) bool {
		if accounts[i].OrderIndex != accounts[j].OrderIndex {
			return accounts[i].OrderIndex < accounts[j].OrderIndex
		}
		return accounts[i].ID < accounts[j].ID
	})

	return TelemetrySnapshot{
		ServerTimeMs: time.Now().UnixMilli(),
		BridgePort:   m.bridge.Port(),
		Accounts:     accounts,
	}
}

func (m *AccountManager) telemetryLoop(ctx context.Context) {
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.emitTelemetry()
		case <-m.dirtyCh:
			m.emitTelemetry()
		}
	}
}

func (m *AccountManager) emitTelemetry() {
	m.telemetryListenersMu.RLock()
	fn := m.onTelemetry
	m.telemetryListenersMu.RUnlock()
	if fn != nil {
		fn(m.Snapshot())
	}
}

// ParseImportText accepts JSON copied from the PokéIdle bookmarklet/console snippet:
// {"nick":"...","token":"...","dispositivo":"..."} or {"sessao":{...},"dispositivo":"..."}.
func ParseImportText(raw string) (nick, token, deviceID string, err error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", "", "", fmt.Errorf("texto vazio")
	}
	var m map[string]any
	if e := json.Unmarshal([]byte(s), &m); e == nil {
		if sess := asMap(m["sessao"]); sess != nil {
			nick = asString(sess["nick"])
			token = asString(sess["token"])
		}
		if nick == "" {
			nick = asString(m["nick"])
		}
		if token == "" {
			token = asString(m["token"])
		}
		deviceID = asString(m["dispositivo"])
		if deviceID == "" {
			deviceID = asString(m["device_id"])
		}
		if deviceID == "" {
			deviceID = asString(m["deviceId"])
		}
		if nick != "" && token != "" {
			return strings.TrimSpace(nick), strings.TrimSpace(token), strings.TrimSpace(deviceID), nil
		}
	}
	return "", "", "", fmt.Errorf("formato não reconhecido — cole o JSON copiado do jogo (nick, token e dispositivo)")
}
