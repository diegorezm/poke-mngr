package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	AppName        = "PokeMngr"
	MaxAccounts    = 4
	DefaultWSURL   = "wss://pokeidle.io"
	GameAppURL     = "https://pokeidle.io/app"
	SiteOrigin     = "https://pokeidle.io"
	GuideOrigin    = "https://pokeidleguide.io"
	HubOrigin      = "https://pokeidleguide.io"
	WelcomeTimeout = 15 * time.Second
	PingInterval   = 30 * time.Second
	PingTimeout    = 90 * time.Second
	FrameSilence   = 150 * time.Second
	FrameCheck     = 15 * time.Second
	DownAlertDelay = 120 * time.Second
	CooldownDefault = 300 * time.Second
	ReconnectDelay  = 10 * time.Second
	MinUptimeFast   = 5 * time.Second
	NetworkFullRetry = 30 * time.Second

	CorpseWindow       = 30 * time.Second
	BallThrowCooldown  = 1300 * time.Millisecond
	BuyConfirmTimeout  = 20 * time.Second
	SellConfirmTimeout = 20 * time.Second
	RestockCheckEvery  = 5 * time.Second
	RestockRetryGap    = 30 * time.Second

	DefaultExternalLoginWaitMin = 5
)

var DefaultBallPriority = []int{1, 2, 3, 4}

var KnownPotionIDs = map[int]bool{
	200:   true, // Small Potion
	201:   true, // Great Potion
	202:   true, // Ultra Potion
	203:   true, // Hyper Potion
	204:   true, // Ultimate Potion
	70070: true, // Golden Potion
}

var BuyableBallIDs = map[int]bool{
	1: true, // Poke Ball
	2: true, // Great Ball
	3: true, // Super Ball
	4: true, // Ultra Ball
}

var ValidProxySchemes = map[string]bool{
	"http":    true,
	"https":   true,
	"socks5":  true,
	"socks5h": true,
	"socks4":  true,
}

// DataDir returns %LOCALAPPDATA%\PokeMngr on Windows (or user config dir fallback).
func DataDir() string {
	if custom := strings.TrimSpace(os.Getenv("POKE_MNGR_DATA_DIR")); custom != "" {
		_ = os.MkdirAll(custom, 0o700)
		return custom
	}
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		if dir, err := os.UserConfigDir(); err == nil {
			base = dir
		} else {
			base = "."
		}
	}
	dir := filepath.Join(base, AppName)
	_ = os.MkdirAll(dir, 0o700)
	return dir
}

func DBPath() string {
	return filepath.Join(DataDir(), "app.db")
}

func WebView2BaseDir() string {
	dir := filepath.Join(DataDir(), "WebView2")
	_ = os.MkdirAll(dir, 0o700)
	return dir
}

func AccountWebView2Dir(uuid string) string {
	dir := filepath.Join(WebView2BaseDir(), uuid)
	_ = os.MkdirAll(dir, 0o700)
	return dir
}

type ProxyConfig struct {
	Scheme   string `json:"scheme"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username,omitempty"`
	Password string `json:"password,omitempty"`
}

func (p *ProxyConfig) Active() bool {
	return p != nil && strings.TrimSpace(p.Host) != "" && p.Port > 0
}

func (p *ProxyConfig) Label() string {
	if !p.Active() {
		return ""
	}
	scheme := strings.ToLower(strings.TrimSpace(p.Scheme))
	if scheme == "" {
		scheme = "socks5"
	}
	return fmt.Sprintf("%s://%s:%d", scheme, strings.TrimSpace(p.Host), p.Port)
}

func (p *ProxyConfig) URL() string {
	if !p.Active() {
		return ""
	}
	scheme := strings.ToLower(strings.TrimSpace(p.Scheme))
	if scheme == "" {
		scheme = "socks5"
	}
	u := &url.URL{
		Scheme: scheme,
		Host:   fmt.Sprintf("%s:%d", strings.TrimSpace(p.Host), p.Port),
	}
	if p.Username != "" {
		if p.Password != "" {
			u.User = url.UserPassword(p.Username, p.Password)
		} else {
			u.User = url.User(p.Username)
		}
	}
	return u.String()
}

// RestockRule mirrors pokeidleDeck's hysteresis & advanced restock combined with manager-online's restock.
type RestockRule struct {
	Enabled bool `json:"enabled"`
	ID      int  `json:"id"`    // 0 = auto (equipped / best HP/gold for potions)
	Below   int  `json:"below"` // trigger threshold
	Keep    int  `json:"keep"`  // refill up to this target (or buy qty if Keep <= Below)
}

type RestockConfig struct {
	Enabled     bool        `json:"enabled"`
	GoldFloor   int64       `json:"goldFloor"`   // never spend below this gold floor
	PotionFirst bool        `json:"potionFirst"` // move chosen potion to index 0 of automation.potionIds
	Potion      RestockRule `json:"potion"`
	Ball        RestockRule `json:"ball"`
	Revive      RestockRule `json:"revive"`
}

func DefaultRestockConfig() RestockConfig {
	return RestockConfig{
		Enabled:     true,
		GoldFloor:   0,
		PotionFirst: false,
		Potion:      RestockRule{Enabled: true, ID: 0, Below: 10, Keep: 110},
		Ball:        RestockRule{Enabled: true, ID: 0, Below: 10, Keep: 110},
		Revive:      RestockRule{Enabled: false, ID: 0, Below: 50, Keep: 200},
	}
}

type AccountOptions struct {
	HuntSlug               string        `json:"huntSlug"`
	AutoCatch              bool          `json:"autoCatch"`
	BallPriority           []int         `json:"ballPriority"`
	AutoPotion             bool          `json:"autoPotion"`
	PotionID               *int          `json:"potionId"`
	PotionRestockThreshold int           `json:"potionRestockThreshold"`
	PotionRestockQty       int           `json:"potionRestockQty"`
	AutoBallRestock        bool          `json:"autoBallRestock"`
	BallID                 *int          `json:"ballId"`
	BallRestockThreshold   int           `json:"ballRestockThreshold"`
	BallRestockQty         int           `json:"ballRestockQty"`
	PvpAuto                bool          `json:"pvpAuto"`
	DirectMode             bool          `json:"directMode"` // fallback Caminho 2 for this account
	Restock                RestockConfig `json:"restock"`
}

func DefaultAccountOptions() AccountOptions {
	return AccountOptions{
		AutoCatch:              true,
		BallPriority:           []int{1, 2, 3, 4},
		AutoPotion:             true,
		PotionRestockThreshold: 10,
		PotionRestockQty:       100,
		AutoBallRestock:        true,
		BallRestockThreshold:   10,
		BallRestockQty:         100,
		PvpAuto:                false,
		DirectMode:             false,
		Restock:                DefaultRestockConfig(),
	}
}

type AccountRecord struct {
	ID          int            `json:"id"`
	UUID        string         `json:"uuid"`
	Nick        string         `json:"nick"`
	Token       string         `json:"token,omitempty"`
	TokenHint   string         `json:"tokenHint,omitempty"`
	DeviceID    string         `json:"deviceId"`
	Enabled     bool           `json:"enabled"`
	OrderIndex  int            `json:"orderIndex"`
	Proxy       *ProxyConfig   `json:"proxy,omitempty"`
	Options     AccountOptions `json:"options"`
	TokenStatus string         `json:"tokenStatus"`
	TokenDetail string         `json:"tokenDetail"`
	CreatedAt   int64          `json:"createdAt"`
}

func (a AccountRecord) Name() string {
	return fmt.Sprintf("ACC%d:%s", a.ID, a.Nick)
}

func (a AccountRecord) Redacted() AccountRecord {
	cp := a
	if len(cp.Token) > 6 {
		cp.TokenHint = "…" + cp.Token[len(cp.Token)-6:]
	} else if len(cp.Token) > 0 {
		cp.TokenHint = "••••"
	}
	cp.Token = ""
	if cp.Proxy != nil {
		p := *cp.Proxy
		if p.Password != "" {
			p.Password = "••••"
		}
		cp.Proxy = &p
	}
	return cp
}

type GlobalSettings struct {
	WSURL                 string `json:"wsUrl"`
	DiscordWebhookURL     string `json:"discordWebhookUrl"`
	DailyReportHour       int    `json:"dailyReportHour"`
	ReportTZ              string `json:"reportTz"`
	ExternalLoginWaitMin  int    `json:"externalLoginWaitMin"`
	DownAlertDelaySec     int    `json:"downAlertDelaySec"`
	MinimizeToTrayOnClose bool   `json:"minimizeToTrayOnClose"`
	StartMinimized        bool   `json:"startMinimized"`
	CardStyle             string  `json:"cardStyle"` // padrao | medalhao | versus | corrida
	Language              string  `json:"language"`  // pt | en
	SniperEnabled         bool    `json:"sniperEnabled"`
	MarketSellAlert       bool    `json:"marketSellAlert"`
	MarketSellAlertPct    int     `json:"marketSellAlertPct"`
	DeckLayout            string  `json:"deckLayout"` // grid | columns | focus
	DeckZoom              float64 `json:"deckZoom"`
	DeckUltra             bool   `json:"deckUltra"`
	DeckReduceMotion      bool   `json:"deckReduceMotion"`
	DeckHuntExt           bool   `json:"deckHuntExt"`
}

func DefaultGlobalSettings() GlobalSettings {
	return GlobalSettings{
		WSURL:                 DefaultWSURL,
		DailyReportHour:       0,
		ReportTZ:              "America/Sao_Paulo",
		ExternalLoginWaitMin:  DefaultExternalLoginWaitMin,
		DownAlertDelaySec:     int(DownAlertDelay.Seconds()),
		MinimizeToTrayOnClose: true,
		StartMinimized:        false,
		CardStyle:             "padrao",
		Language:              "pt",
		SniperEnabled:         false,
		MarketSellAlert:       false,
		MarketSellAlertPct:    30,
		DeckLayout:            "grid",
		DeckZoom:              1.0,
		DeckUltra:             false,
		DeckReduceMotion:      true,
		DeckHuntExt:           false,
	}
}
