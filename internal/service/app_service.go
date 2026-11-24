package service

import (
	"context"
	"fmt"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"poke-mngr/internal/config"
	"poke-mngr/internal/deck"
	"poke-mngr/internal/lives"
	"poke-mngr/internal/pokeidle"
	"poke-mngr/internal/store"
)

type AppService struct {
	app   *application.App
	mgr   *pokeidle.AccountManager
	lives *lives.Manager

	winMu       sync.Mutex
	gameWindows map[int]*application.WebviewWindow
	liveWindows map[string]*application.WebviewWindow
}

func NewAppService(mgr *pokeidle.AccountManager) *AppService {
	return &AppService{
		mgr:         mgr,
		lives:       lives.NewManager(mgr, mgr.Store()),
		gameWindows: map[int]*application.WebviewWindow{},
		liveWindows: map[string]*application.WebviewWindow{},
	}
}

func (s *AppService) BindApp(app *application.App) {
	s.app = app
}

// --- Telemetry & Accounts ---

func (s *AppService) GetSnapshot() pokeidle.TelemetrySnapshot {
	return s.mgr.Snapshot()
}

func (s *AppService) ListAccounts() ([]config.AccountRecord, error) {
	return s.mgr.ListAccountsRedacted()
}

type ImportParsed struct {
	Nick     string `json:"nick"`
	Token    string `json:"token"`
	DeviceID string `json:"deviceId"`
}

func (s *AppService) ParseImportText(raw string) (ImportParsed, error) {
	nick, tok, dev, err := pokeidle.ParseImportText(raw)
	if err != nil {
		return ImportParsed{}, err
	}
	return ImportParsed{Nick: nick, Token: tok, DeviceID: dev}, nil
}

type AddAccountRequest struct {
	Nick     string                `json:"nick"`
	Token    string                `json:"token"`
	DeviceID string                `json:"deviceId"`
	Enabled  bool                  `json:"enabled"`
	Proxy    *config.ProxyConfig   `json:"proxy,omitempty"`
	Options  config.AccountOptions `json:"options"`
	SkipTest bool                  `json:"skipTest"`
}

type AddAccountResponse struct {
	Account config.AccountRecord  `json:"account"`
	Probe   *pokeidle.ProbeResult `json:"probe,omitempty"`
}

func (s *AppService) AddAccount(req AddAccountRequest) (AddAccountResponse, error) {
	opts := req.Options
	if len(opts.BallPriority) == 0 {
		opts = config.DefaultAccountOptions()
	}
	rec := config.AccountRecord{
		Nick:     req.Nick,
		Token:    req.Token,
		DeviceID: req.DeviceID,
		Enabled:  req.Enabled,
		Proxy:    req.Proxy,
		Options:  opts,
	}
	saved, probe, err := s.mgr.AddAccount(rec, req.SkipTest)
	if err != nil {
		return AddAccountResponse{Probe: probe}, err
	}
	return AddAccountResponse{Account: saved, Probe: probe}, nil
}

func (s *AppService) UpdateAccount(acc config.AccountRecord) (config.AccountRecord, error) {
	return s.mgr.UpdateAccount(acc)
}

func (s *AppService) DeleteAccount(id int) error {
	s.CloseGameWindow(id)
	return s.mgr.DeleteAccount(id)
}

func (s *AppService) RestartAccount(id int) error {
	return s.mgr.RestartAccount(id)
}

func (s *AppService) ReorderAccounts(ids []int) error {
	return s.mgr.ReorderAccounts(ids)
}

func (s *AppService) TestProxy(proxyCfg config.ProxyConfig) (string, error) {
	var p *config.ProxyConfig
	if proxyCfg.Active() {
		p = &proxyCfg
	}
	return pokeidle.ProbeExitIP(context.Background(), p)
}

func (s *AppService) TestAccount(id int) (pokeidle.ProbeResult, error) {
	conn := s.mgr.GetConnection(id)
	if conn == nil {
		return pokeidle.ProbeResult{}, fmt.Errorf("conta não encontrada")
	}
	return pokeidle.ProbeAccount(context.Background(), conn.Account(), s.mgr.Settings().WSURL), nil
}

// --- Settings, Autostart & Discord ---

func (s *AppService) GetSettings() config.GlobalSettings {
	return s.mgr.Settings()
}

func (s *AppService) UpdateSettings(gs config.GlobalSettings) error {
	prev := s.mgr.Settings()
	if err := s.mgr.UpdateSettings(gs); err != nil {
		return err
	}
	if prev.DeckUltra != gs.DeckUltra || prev.DeckReduceMotion != gs.DeckReduceMotion {
		s.syncGameWindowsDisplay(gs.DeckUltra, gs.DeckReduceMotion)
	}
	return nil
}

func (s *AppService) syncGameWindowsDisplay(ultra, reduceMotion bool) {
	s.winMu.Lock()
	wins := make([]*application.WebviewWindow, 0, len(s.gameWindows))
	for _, w := range s.gameWindows {
		if w != nil {
			wins = append(wins, w)
		}
	}
	s.winMu.Unlock()
	if len(wins) == 0 {
		return
	}
	js := fmt.Sprintf(
		`if (window.__pokeMngrDeck) { window.__pokeMngrDeck.setUltra(%t); window.__pokeMngrDeck.setReduceMotion(%t); }`,
		ultra,
		reduceMotion,
	)
	for _, w := range wins {
		w.ExecJS(js)
	}
}

func (s *AppService) GetAutostart() (bool, error) {
	if s.app == nil || s.app.Autostart == nil {
		return false, nil
	}
	return s.app.Autostart.IsEnabled()
}

func (s *AppService) SetAutostart(enabled bool) error {
	if s.app == nil || s.app.Autostart == nil {
		return fmt.Errorf("autostart indisponível neste ambiente")
	}
	if enabled {
		return s.app.Autostart.Enable()
	}
	return s.app.Autostart.Disable()
}

func (s *AppService) TestDiscordWebhook(webhookURL string) error {
	return s.mgr.Notifier().SendSync(context.Background(), webhookURL, pokeidle.DiscordEmbed{
		Title:       "PokeMngr — Teste de Webhook",
		Description: "Conexão com o Discord funcionando corretamente!",
		Color:       pokeidle.ColorGreen,
	})
}

func (s *AppService) SendDailyReportNow(webhookURL string) error {
	return s.mgr.SendDailyReportNow(context.Background(), webhookURL)
}

func (s *AppService) GetBookmarkletCode() string {
	return deck.BookmarkletSnippet
}

// --- Live Gameplay Actions ---

func (s *AppService) EquipItem(accountID int, kind string, itemID int) error {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return fmt.Errorf("conta não encontrada")
	}
	return conn.EquipItem(context.Background(), kind, itemID, true)
}

func (s *AppService) SelectHunt(accountID int, slug string) error {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return fmt.Errorf("conta não encontrada")
	}
	return conn.SelectHunt(context.Background(), slug)
}

func (s *AppService) CancelPendingHunt(accountID int) error {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return fmt.Errorf("conta não encontrada")
	}
	conn.CancelPendingHunt()
	return nil
}

func (s *AppService) SelectOutlandTier(accountID int, tier int) error {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return fmt.Errorf("conta não encontrada")
	}
	return conn.SelectOutlandTier(context.Background(), tier)
}

func (s *AppService) ClaimPass(accountID int) error {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return fmt.Errorf("conta não encontrada")
	}
	return conn.ClaimPass(context.Background())
}

func (s *AppService) ClaimAllPasses() (int, error) {
	snap := s.mgr.Snapshot()
	claimed := 0
	for _, a := range snap.Accounts {
		if a.State == pokeidle.StateOnline && a.Pass.CanClaim {
			if err := s.ClaimPass(a.ID); err == nil {
				claimed++
			}
		}
	}
	return claimed, nil
}

func (s *AppService) GetHuntsCatalog(accountID int) pokeidle.HuntsCatalog {
	return s.mgr.BuildHuntsCatalog(accountID)
}

func (s *AppService) GetActivePokemonSheet(accountID int) (*pokeidle.ActivePokemonSheet, error) {
	return s.mgr.GetActivePokemonSheet(accountID)
}

func (s *AppService) GetInventory(accountID int) pokeidle.InventorySummary {
	return s.mgr.BuildInventory(accountID)
}

func (s *AppService) ListPokemons(accountID int, sortBy string) []pokeidle.PokemonDetail {
	return s.mgr.ListPokemons(accountID, sortBy)
}

func (s *AppService) GetChatMessages(canal string) []pokeidle.ChatMessage {
	return s.mgr.Chat().Messages(canal)
}

func (s *AppService) SendChatMessage(accountID int, canal, texto string) error {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return fmt.Errorf("conta não encontrada")
	}
	return s.mgr.Chat().Send(context.Background(), conn, canal, texto)
}

func (s *AppService) ResetSession(accountID int) error {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return fmt.Errorf("conta não encontrada")
	}
	conn.ResetSession()
	return nil
}

func (s *AppService) SellDepot(accountID int) (*pokeidle.SellResult, error) {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return nil, fmt.Errorf("conta não encontrada")
	}
	return conn.SellDepot(context.Background())
}

// --- Caminho 1 Visual Game Viewer Window & Embedded Deck URL ---

func (s *AppService) GetGameURL(accountID int) (string, error) {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return "", fmt.Errorf("conta não encontrada")
	}
	return s.mgr.Bridge().GameURL(accountID), nil
}

func (s *AppService) OpenGameWindow(accountID int) error {
	if s.app == nil {
		return fmt.Errorf("aplicação não inicializada")
	}
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return fmt.Errorf("conta não encontrada")
	}

	s.winMu.Lock()
	if existing, ok := s.gameWindows[accountID]; ok && existing != nil {
		s.winMu.Unlock()
		existing.Show()
		existing.Focus()
		return nil
	}
	s.winMu.Unlock()

	acc := conn.Account()
	gs := s.mgr.Settings()
	gameURL := s.mgr.Bridge().GameURL(acc.ID)

	win := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:               fmt.Sprintf("game-%d", acc.ID),
		Title:              fmt.Sprintf("PokeIdle — %s (Bridge)", acc.Nick),
		Width:              1120,
		Height:             760,
		MinWidth:           520,
		MinHeight:          400,
		BackgroundColour:   application.NewRGB(9, 11, 20),
		URL:                gameURL,
		Zoom:               gs.DeckZoom,
		ZoomControlEnabled: true,
	})

	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		s.winMu.Lock()
		delete(s.gameWindows, accountID)
		s.winMu.Unlock()
	})

	s.winMu.Lock()
	s.gameWindows[accountID] = win
	s.winMu.Unlock()
	win.Show()
	win.Focus()
	return nil
}

func (s *AppService) CloseGameWindow(accountID int) {
	s.winMu.Lock()
	win := s.gameWindows[accountID]
	delete(s.gameWindows, accountID)
	s.winMu.Unlock()
	if win != nil {
		win.Close()
	}
}

func (s *AppService) OpenAllGameWindows() error {
	snap := s.mgr.Snapshot()
	for _, a := range snap.Accounts {
		if a.Enabled {
			if err := s.OpenGameWindow(a.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *AppService) CloseAllGameWindows() {
	s.winMu.Lock()
	wins := make([]*application.WebviewWindow, 0, len(s.gameWindows))
	for id, w := range s.gameWindows {
		wins = append(wins, w)
		delete(s.gameWindows, id)
	}
	lwins := make([]*application.WebviewWindow, 0, len(s.liveWindows))
	for k, w := range s.liveWindows {
		lwins = append(lwins, w)
		delete(s.liveWindows, k)
	}
	s.winMu.Unlock()
	for _, w := range wins {
		if w != nil {
			w.Close()
		}
	}
	for _, w := range lwins {
		if w != nil {
			w.Close()
		}
	}
}

// --- Market & Sniper Service Methods (Fase 4) ---

func (s *AppService) GetMarketOverview() (map[string]any, error) {
	return s.mgr.Market().Overview(context.Background())
}

func (s *AppService) GetMarketItemListings(itemID int, moeda string, accountID int) (map[string]any, error) {
	return s.mgr.Market().ItemListings(context.Background(), itemID, moeda, accountID)
}

func (s *AppService) GetMarketVitrine(filters map[string]any, accountID int) (map[string]any, error) {
	return s.mgr.Market().Vitrine(context.Background(), filters, accountID)
}

func (s *AppService) GetMarketTape(mode string, page int, accountID int) (map[string]any, error) {
	return s.mgr.Market().Tape(context.Background(), mode, page, accountID)
}

func (s *AppService) GetMarketMyListings(accountID int) (map[string]any, error) {
	return s.mgr.Market().MyListings(context.Background(), accountID)
}

func (s *AppService) GetMarketWallet(accountID int) (map[string]any, error) {
	return s.mgr.Market().Wallet(context.Background(), accountID)
}

func (s *AppService) BuyMarketListing(accountID, listingID, qty int, price int64, moeda string) (pokeidle.MarketBuyResult, error) {
	return s.mgr.Market().BuyListing(context.Background(), accountID, listingID, qty, price, moeda)
}

func (s *AppService) GetMarketGuideStats(days int) (map[string]any, error) {
	return s.mgr.Market().GuideStats(context.Background(), days)
}

func (s *AppService) GetMarketGuideSeries(name, moeda string, days int) (map[string]any, error) {
	return s.mgr.Market().GuideSeries(context.Background(), name, moeda, days)
}

func (s *AppService) GetMarketListingDetail(listingID int) (*pokeidle.ListingDetail, error) {
	return s.mgr.Market().GetListingDetail(context.Background(), listingID)
}

func (s *AppService) GetPublicPokemonSheet(nick string, pokemonID int) (*pokeidle.PokemonDetail, error) {
	return s.mgr.GetPublicPokemonSheet(context.Background(), nick, pokemonID)
}

func (s *AppService) GetInventoryValuation(accountID int) (*pokeidle.InventoryValuation, error) {
	return s.mgr.Market().Valuation(context.Background(), accountID)
}

func (s *AppService) SetMarketSellAlert(enabled bool, pct int) error {
	gs := s.mgr.Settings()
	gs.MarketSellAlert = enabled
	if pct >= 5 {
		gs.MarketSellAlertPct = pct
	}
	return s.mgr.UpdateSettings(gs)
}

func (s *AppService) ToggleMarketFav(itemID int) (bool, error) {
	return s.mgr.Store().ToggleMarketFav(itemID)
}

func (s *AppService) ListMarketRules() ([]store.MarketRule, error) {
	return s.mgr.Store().ListMarketRules()
}

func (s *AppService) SaveMarketRule(rule store.MarketRule) (store.MarketRule, error) {
	return s.mgr.Store().SaveMarketRule(rule)
}

func (s *AppService) ToggleMarketRule(id int) (bool, error) {
	return s.mgr.Store().ToggleMarketRule(id)
}

func (s *AppService) DeleteMarketRule(id int) error {
	return s.mgr.Store().DeleteMarketRule(id)
}

func (s *AppService) ListMarketLog() ([]store.MarketLogEntry, error) {
	return s.mgr.Store().ListMarketLog(150)
}

func (s *AppService) SetSniperEnabled(enabled bool) error {
	gs := s.mgr.Settings()
	gs.SniperEnabled = enabled
	return s.mgr.UpdateSettings(gs)
}

// --- PvP Service Methods (Fase 4) ---

func (s *AppService) GetPvpOverview() []pokeidle.PvpAccountView {
	return s.mgr.ListPvpViews()
}

func (s *AppService) SetPvpAuto(accountID int, enabled bool) error {
	return s.mgr.SetPvpAuto(accountID, enabled)
}

func (s *AppService) PvpQueueAction(accountID int, enter bool) error {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return fmt.Errorf("conta não encontrada")
	}
	if enter {
		return conn.Pvp().EnterQueue(context.Background())
	}
	return conn.Pvp().LeaveQueue(context.Background())
}

func (s *AppService) SavePvpTeam(accountID int, pokemonIDs []int, houses map[string]int) error {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		return fmt.Errorf("conta não encontrada")
	}
	return conn.Pvp().SaveTeam(context.Background(), pokemonIDs, houses)
}

func (s *AppService) GetPvpLadder(accountID, page int) (map[string]any, error) {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		for _, a := range s.mgr.Snapshot().Accounts {
			if a.State == pokeidle.StateOnline {
				conn = s.mgr.GetConnection(a.ID)
				break
			}
		}
	}
	if conn == nil {
		return nil, fmt.Errorf("nenhuma conta online")
	}
	return conn.Pvp().RequestLadder(context.Background(), page)
}

func (s *AppService) GetPvpMonthly(accountID, page int) (map[string]any, error) {
	conn := s.mgr.GetConnection(accountID)
	if conn == nil {
		for _, a := range s.mgr.Snapshot().Accounts {
			if a.State == pokeidle.StateOnline {
				conn = s.mgr.GetConnection(a.ID)
				break
			}
		}
	}
	if conn == nil {
		return nil, fmt.Errorf("nenhuma conta online")
	}
	return conn.Pvp().RequestMonthly(context.Background(), page)
}

// --- Lives (Twitch & Kick) Service Methods (Fase 5) ---

func (s *AppService) GetLivesState() lives.CentralState {
	return s.lives.State()
}

func (s *AppService) RefreshLivesStatus() lives.CentralState {
	s.lives.RefreshExtraLiveStatus(context.Background())
	return s.lives.State()
}

func (s *AppService) SaveLivesConfig(accountID int, cfg store.LivesAccountConfig) error {
	return s.mgr.Store().SaveLivesConfig(accountID, cfg)
}

func (s *AppService) OpenLivePlayer(accountID int, site string, slot int, channel string, hidden bool) error {
	if s.app == nil {
		return fmt.Errorf("aplicação não inicializada")
	}
	if channel == "" {
		return fmt.Errorf("canal vazio")
	}
	key := fmt.Sprintf("%d:%s:%d", accountID, site, slot)
	s.StopLivePlayer(accountID, site, slot)

	targetURL := s.lives.PlayerURL(site, channel)
	bootHTML := fmt.Sprintf(`<!doctype html><html><body style="background:#000;margin:0"><script>location.replace(%q);</script></body></html>`, targetURL)

	win := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "live-" + key,
		Title:            fmt.Sprintf("Live %s — %s (Conta #%d)", site, channel, accountID),
		Width:            640,
		Height:           380,
		Hidden:           hidden,
		BackgroundColour: application.NewRGB(0, 0, 0),
		HTML:             bootHTML,
		JS:               lives.VisibleAndMuteJS,
	})
	win.RegisterHook(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		s.winMu.Lock()
		delete(s.liveWindows, key)
		s.winMu.Unlock()
		s.lives.SetPlayerPlaying(accountID, site, slot, "")
	})
	s.winMu.Lock()
	s.liveWindows[key] = win
	s.winMu.Unlock()
	s.lives.SetPlayerPlaying(accountID, site, slot, channel)
	_ = s.mgr.Store().AppendLivesLog(accountID, site, channel, "player", fmt.Sprintf("Player iniciado (slot %d)", slot))
	if !hidden {
		win.Show()
	}
	return nil
}

func (s *AppService) StopLivePlayer(accountID int, site string, slot int) {
	key := fmt.Sprintf("%d:%s:%d", accountID, site, slot)
	s.winMu.Lock()
	w := s.liveWindows[key]
	delete(s.liveWindows, key)
	s.winMu.Unlock()
	if w != nil {
		w.Close()
	}
	s.lives.SetPlayerPlaying(accountID, site, slot, "")
}

func (s *AppService) OpenLivePointsPage(site, channel string) error {
	if s.app == nil {
		return fmt.Errorf("aplicação não inicializada")
	}
	u := s.lives.PointsURL(site, channel)
	win := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   fmt.Sprintf("points-%s-%s", site, channel),
		Title:  fmt.Sprintf("Pontos %s — %s", site, channel),
		Width:  460,
		Height: 720,
		URL:    u,
	})
	win.Show()
	win.Focus()
	return nil
}

func (s *AppService) OpenLiveLogin(site string) error {
	if s.app == nil {
		return fmt.Errorf("aplicação não inicializada")
	}
	u := s.lives.LoginURL(site)
	win := s.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   "login-" + site,
		Title:  fmt.Sprintf("Entrar na %s", site),
		Width:  540,
		Height: 740,
		URL:    u,
	})
	win.Show()
	win.Focus()
	return nil
}
