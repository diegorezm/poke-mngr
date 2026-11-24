package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"

	"poke-mngr/internal/config"
)

type Store struct {
	mu sync.Mutex
	db *sql.DB
}

func Open(path string) (*Store, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) migrate() error {
	schema := `
CREATE TABLE IF NOT EXISTS accounts (
	id            INTEGER PRIMARY KEY AUTOINCREMENT,
	uuid          TEXT    NOT NULL UNIQUE,
	nick          TEXT    NOT NULL,
	token         TEXT    NOT NULL,
	device_id     TEXT    NOT NULL,
	enabled       INTEGER NOT NULL DEFAULT 1,
	order_index   INTEGER NOT NULL DEFAULT 0,
	proxy_scheme  TEXT    NOT NULL DEFAULT '',
	proxy_host    TEXT    NOT NULL DEFAULT '',
	proxy_port    INTEGER NOT NULL DEFAULT 0,
	proxy_user    TEXT    NOT NULL DEFAULT '',
	proxy_pass    TEXT    NOT NULL DEFAULT '',
	opts_json     TEXT    NOT NULL DEFAULT '{}',
	token_status  TEXT    NOT NULL DEFAULT 'ok',
	token_detail  TEXT    NOT NULL DEFAULT '',
	created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_state (
	account_id   INTEGER PRIMARY KEY,
	started_at   INTEGER NOT NULL DEFAULT 0,
	gained_json  TEXT    NOT NULL DEFAULT '{}',
	shinies_json TEXT    NOT NULL DEFAULT '{}',
	FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_state (
	period     TEXT NOT NULL,
	nick       TEXT NOT NULL,
	xp         INTEGER NOT NULL DEFAULT 0,
	gold       INTEGER NOT NULL DEFAULT 0,
	kills      INTEGER NOT NULL DEFAULT 0,
	items_json TEXT NOT NULL DEFAULT '{}',
	PRIMARY KEY(period, nick)
);

CREATE TABLE IF NOT EXISTS market_favs (
	item_id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS market_rules (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	kind       TEXT    NOT NULL,
	enabled    INTEGER NOT NULL DEFAULT 1,
	spec_json  TEXT    NOT NULL,
	spent      INTEGER NOT NULL DEFAULT 0,
	spent_day  TEXT    NOT NULL DEFAULT '',
	last_fire  INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_rule_spend (
	rule_id    INTEGER NOT NULL,
	account_id INTEGER NOT NULL,
	day        TEXT    NOT NULL,
	spent      INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY(rule_id, account_id, day)
);

CREATE TABLE IF NOT EXISTS price_history (
	ts       INTEGER NOT NULL,
	item_id  INTEGER NOT NULL,
	min_gold INTEGER NOT NULL DEFAULT 0,
	min_orb  INTEGER NOT NULL DEFAULT 0,
	ads      INTEGER NOT NULL DEFAULT 0,
	units    INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY(ts, item_id)
);

CREATE TABLE IF NOT EXISTS market_sales (
	id      TEXT    PRIMARY KEY,
	ts      INTEGER NOT NULL,
	kind    TEXT    NOT NULL,
	moeda   TEXT    NOT NULL,
	price   INTEGER NOT NULL,
	qty     INTEGER NOT NULL,
	name    TEXT    NOT NULL,
	species TEXT    NOT NULL DEFAULT '',
	shiny   INTEGER NOT NULL DEFAULT 0,
	iv      REAL    NOT NULL DEFAULT 0,
	level   INTEGER NOT NULL DEFAULT 0,
	look    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_market_sales_ts ON market_sales(ts);

CREATE TABLE IF NOT EXISTS market_log (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	ts         INTEGER NOT NULL,
	account_id INTEGER NOT NULL DEFAULT 0,
	rule_id    INTEGER NOT NULL DEFAULT 0,
	status     TEXT    NOT NULL,
	text       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS lives_config (
	account_id INTEGER PRIMARY KEY,
	config_json TEXT NOT NULL DEFAULT '{}',
	FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS lives_log (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	ts         INTEGER NOT NULL,
	account_id INTEGER NOT NULL,
	site       TEXT    NOT NULL,
	channel    TEXT    NOT NULL,
	kind       TEXT    NOT NULL,
	message    TEXT    NOT NULL
);
`
	_, err := s.db.Exec(schema)
	return err
}

// --- Accounts ---

func (s *Store) ListAccounts() ([]config.AccountRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(`
		SELECT id, uuid, nick, token, device_id, enabled, order_index,
		       proxy_scheme, proxy_host, proxy_port, proxy_user, proxy_pass,
		       opts_json, token_status, token_detail, created_at
		FROM accounts
		ORDER BY order_index ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []config.AccountRecord
	for rows.Next() {
		var a config.AccountRecord
		var enabled int
		var pScheme, pHost, pUser, pPass, optsJSON string
		var pPort int
		if err := rows.Scan(
			&a.ID, &a.UUID, &a.Nick, &a.Token, &a.DeviceID, &enabled, &a.OrderIndex,
			&pScheme, &pHost, &pPort, &pUser, &pPass,
			&optsJSON, &a.TokenStatus, &a.TokenDetail, &a.CreatedAt,
		); err != nil {
			return nil, err
		}
		a.Enabled = enabled != 0
		if strings.TrimSpace(pHost) != "" && pPort > 0 {
			a.Proxy = &config.ProxyConfig{
				Scheme:   pScheme,
				Host:     pHost,
				Port:     pPort,
				Username: pUser,
				Password: pPass,
			}
		}
		a.Options = config.DefaultAccountOptions()
		if optsJSON != "" && optsJSON != "{}" {
			_ = json.Unmarshal([]byte(optsJSON), &a.Options)
		}
		if len(a.Options.BallPriority) == 0 {
			a.Options.BallPriority = append([]int(nil), config.DefaultBallPriority...)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Store) GetAccount(id int) (*config.AccountRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var a config.AccountRecord
	var enabled int
	var pScheme, pHost, pUser, pPass, optsJSON string
	var pPort int
	err := s.db.QueryRow(`
		SELECT id, uuid, nick, token, device_id, enabled, order_index,
		       proxy_scheme, proxy_host, proxy_port, proxy_user, proxy_pass,
		       opts_json, token_status, token_detail, created_at
		FROM accounts
		WHERE id = ?
	`, id).Scan(
		&a.ID, &a.UUID, &a.Nick, &a.Token, &a.DeviceID, &enabled, &a.OrderIndex,
		&pScheme, &pHost, &pPort, &pUser, &pPass,
		&optsJSON, &a.TokenStatus, &a.TokenDetail, &a.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	a.Enabled = enabled != 0
	if strings.TrimSpace(pHost) != "" && pPort > 0 {
		a.Proxy = &config.ProxyConfig{
			Scheme:   pScheme,
			Host:     pHost,
			Port:     pPort,
			Username: pUser,
			Password: pPass,
		}
	}
	a.Options = config.DefaultAccountOptions()
	if optsJSON != "" && optsJSON != "{}" {
		_ = json.Unmarshal([]byte(optsJSON), &a.Options)
	}
	if len(a.Options.BallPriority) == 0 {
		a.Options.BallPriority = append([]int(nil), config.DefaultBallPriority...)
	}
	return &a, nil
}

func (s *Store) AddAccount(acc config.AccountRecord) (config.AccountRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM accounts`).Scan(&count); err != nil {
		return config.AccountRecord{}, err
	}
	if count >= config.MaxAccounts {
		return config.AccountRecord{}, fmt.Errorf("limite máximo de %d contas atingido (ToS do PokéIdle)", config.MaxAccounts)
	}

	if acc.UUID == "" {
		acc.UUID = uuid.NewString()
	}
	if acc.DeviceID == "" {
		acc.DeviceID = uuid.NewString()
	}
	if acc.CreatedAt == 0 {
		acc.CreatedAt = time.Now().Unix()
	}
	if acc.TokenStatus == "" {
		acc.TokenStatus = "ok"
	}
	acc.OrderIndex = count

	optsBytes, _ := json.Marshal(acc.Options)
	var pScheme, pHost, pUser, pPass string
	var pPort int
	if acc.Proxy != nil && acc.Proxy.Active() {
		pScheme = acc.Proxy.Scheme
		pHost = acc.Proxy.Host
		pPort = acc.Proxy.Port
		pUser = acc.Proxy.Username
		pPass = acc.Proxy.Password
	}
	enabled := 0
	if acc.Enabled {
		enabled = 1
	}

	res, err := s.db.Exec(`
		INSERT INTO accounts (uuid, nick, token, device_id, enabled, order_index,
		                      proxy_scheme, proxy_host, proxy_port, proxy_user, proxy_pass,
		                      opts_json, token_status, token_detail, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, acc.UUID, acc.Nick, acc.Token, acc.DeviceID, enabled, acc.OrderIndex,
		pScheme, pHost, pPort, pUser, pPass, string(optsBytes), acc.TokenStatus, acc.TokenDetail, acc.CreatedAt)
	if err != nil {
		return config.AccountRecord{}, err
	}
	id, _ := res.LastInsertId()
	acc.ID = int(id)
	return acc, nil
}

func (s *Store) UpdateAccount(acc config.AccountRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	optsBytes, _ := json.Marshal(acc.Options)
	var pScheme, pHost, pUser, pPass string
	var pPort int
	if acc.Proxy != nil && acc.Proxy.Active() {
		pScheme = acc.Proxy.Scheme
		pHost = acc.Proxy.Host
		pPort = acc.Proxy.Port
		pUser = acc.Proxy.Username
		pPass = acc.Proxy.Password
	}
	enabled := 0
	if acc.Enabled {
		enabled = 1
	}

	_, err := s.db.Exec(`
		UPDATE accounts
		SET nick = ?, token = ?, device_id = ?, enabled = ?, order_index = ?,
		    proxy_scheme = ?, proxy_host = ?, proxy_port = ?, proxy_user = ?, proxy_pass = ?,
		    opts_json = ?, token_status = ?, token_detail = ?
		WHERE id = ?
	`, acc.Nick, acc.Token, acc.DeviceID, enabled, acc.OrderIndex,
		pScheme, pHost, pPort, pUser, pPass, string(optsBytes), acc.TokenStatus, acc.TokenDetail, acc.ID)
	return err
}

func (s *Store) UpdateAccountToken(id int, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`UPDATE accounts SET token = ?, token_status = 'ok', token_detail = '' WHERE id = ?`, token, id)
	return err
}

func (s *Store) UpdateAccountAuthStatus(id int, status, detail string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`UPDATE accounts SET token_status = ?, token_detail = ? WHERE id = ?`, status, detail, id)
	return err
}

func (s *Store) ReorderAccounts(ids []int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	for idx, id := range ids {
		if _, err := tx.Exec(`UPDATE accounts SET order_index = ? WHERE id = ?`, idx, id); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) DeleteAccount(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM accounts WHERE id = ?`, id)
	return err
}

// --- Settings ---

func (s *Store) GetSetting(key string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var val string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&val)
	if errors.Is(err, sql.ErrNoRows) || err != nil {
		return "", false
	}
	return val, true
}

func (s *Store) SetSetting(key, val string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, key, val)
	return err
}

func (s *Store) LoadGlobalSettings() config.GlobalSettings {
	gs := config.DefaultGlobalSettings()
	raw, ok := s.GetSetting("global_settings")
	if ok && raw != "" {
		_ = json.Unmarshal([]byte(raw), &gs)
	}
	if strings.TrimSpace(gs.WSURL) == "" {
		gs.WSURL = config.DefaultWSURL
	}
	if gs.ExternalLoginWaitMin < 1 {
		gs.ExternalLoginWaitMin = config.DefaultExternalLoginWaitMin
	}
	if gs.DeckZoom < 0.5 || gs.DeckZoom > 1.5 {
		gs.DeckZoom = 1.0
	}
	if gs.CardStyle == "" {
		gs.CardStyle = "padrao"
	}
	if gs.Language == "" {
		gs.Language = "pt"
	}
	if gs.MarketSellAlertPct < 5 {
		gs.MarketSellAlertPct = 30
	}
	return gs
}

func (s *Store) SaveGlobalSettings(gs config.GlobalSettings) error {
	b, err := json.Marshal(gs)
	if err != nil {
		return err
	}
	return s.SetSetting("global_settings", string(b))
}

// --- Session State ---

type SessionSnapshot struct {
	StartedAt int64          `json:"startedAt"`
	Gained    map[string]int `json:"gained"`
	Shinies   ShinyCounts    `json:"shinies"`
}

type ShinyCounts struct {
	Seen     int `json:"seen"`
	Captured int `json:"captured"`
}

func (s *Store) LoadSessionState(accountID int) (*SessionSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var startedAt int64
	var gainedJSON, shiniesJSON string
	err := s.db.QueryRow(`SELECT started_at, gained_json, shinies_json FROM session_state WHERE account_id = ?`, accountID).
		Scan(&startedAt, &gainedJSON, &shiniesJSON)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	snap := &SessionSnapshot{
		StartedAt: startedAt,
		Gained:    map[string]int{},
	}
	_ = json.Unmarshal([]byte(gainedJSON), &snap.Gained)
	_ = json.Unmarshal([]byte(shiniesJSON), &snap.Shinies)
	return snap, nil
}

func (s *Store) SaveSessionState(accountID int, snap SessionSnapshot) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	gBytes, _ := json.Marshal(snap.Gained)
	sBytes, _ := json.Marshal(snap.Shinies)
	_, err := s.db.Exec(`
		INSERT INTO session_state(account_id, started_at, gained_json, shinies_json)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(account_id) DO UPDATE SET
			started_at = excluded.started_at,
			gained_json = excluded.gained_json,
			shinies_json = excluded.shinies_json
	`, accountID, snap.StartedAt, string(gBytes), string(sBytes))
	return err
}

func (s *Store) DeleteSessionState(accountID int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM session_state WHERE account_id = ?`, accountID)
	return err
}

// --- Daily State ---

type DailyAccountStats struct {
	Nick  string         `json:"nick"`
	XP    int64          `json:"xp"`
	Gold  int64          `json:"gold"`
	Kills int64          `json:"kills"`
	Items map[string]int `json:"items"`
}

func (s *Store) AddDailyKill(period, nick string, xp, gold int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		INSERT INTO daily_state(period, nick, xp, gold, kills, items_json)
		VALUES (?, ?, ?, ?, 1, '{}')
		ON CONFLICT(period, nick) DO UPDATE SET
			xp = xp + excluded.xp,
			gold = gold + excluded.gold,
			kills = kills + 1
	`, period, nick, xp, gold)
	return err
}

func (s *Store) AddDailyRareItem(period, nick, itemKey string, delta int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var itemsJSON string
	err := s.db.QueryRow(`SELECT items_json FROM daily_state WHERE period = ? AND nick = ?`, period, nick).Scan(&itemsJSON)
	items := map[string]int{}
	if err == nil && itemsJSON != "" {
		_ = json.Unmarshal([]byte(itemsJSON), &items)
	}
	items[itemKey] += delta
	b, _ := json.Marshal(items)
	_, err = s.db.Exec(`
		INSERT INTO daily_state(period, nick, xp, gold, kills, items_json)
		VALUES (?, ?, 0, 0, 0, ?)
		ON CONFLICT(period, nick) DO UPDATE SET items_json = excluded.items_json
	`, period, nick, string(b))
	return err
}

func (s *Store) LoadDailyPeriod(period string) ([]DailyAccountStats, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(`SELECT nick, xp, gold, kills, items_json FROM daily_state WHERE period = ?`, period)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []DailyAccountStats
	for rows.Next() {
		var d DailyAccountStats
		var itemsJSON string
		if err := rows.Scan(&d.Nick, &d.XP, &d.Gold, &d.Kills, &itemsJSON); err != nil {
			return nil, err
		}
		d.Items = map[string]int{}
		_ = json.Unmarshal([]byte(itemsJSON), &d.Items)
		out = append(out, d)
	}
	return out, rows.Err()
}

// --- Market Favs / Rules / Log ---

func (s *Store) ListMarketFavs() ([]int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(`SELECT item_id FROM market_favs ORDER BY item_id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *Store) ToggleMarketFav(itemID int) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var exists int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM market_favs WHERE item_id = ?`, itemID).Scan(&exists)
	if err != nil {
		return false, err
	}
	if exists > 0 {
		_, err = s.db.Exec(`DELETE FROM market_favs WHERE item_id = ?`, itemID)
		return false, err
	}
	_, err = s.db.Exec(`INSERT INTO market_favs(item_id) VALUES(?)`, itemID)
	return true, err
}

func (s *Store) AppendLivesLog(accountID int, site, channel, kind, message string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		INSERT INTO lives_log(ts, account_id, site, channel, kind, message)
		VALUES (?, ?, ?, ?, ?, ?)
	`, time.Now().Unix(), accountID, site, channel, kind, message)
	if err != nil {
		return err
	}
	// Keep latest 2000 entries
	_, _ = s.db.Exec(`DELETE FROM lives_log WHERE id NOT IN (SELECT id FROM lives_log ORDER BY id DESC LIMIT 2000)`)
	return nil
}

func ParseIntKey(m map[string]any, key string) int {
	if m == nil {
		return 0
	}
	v, ok := m[key]
	if !ok || v == nil {
		return 0
	}
	switch t := v.(type) {
	case float64:
		return int(t)
	case int:
		return t
	case int64:
		return int(t)
	case json.Number:
		i, _ := t.Int64()
		return int(i)
	case string:
		i, _ := strconv.Atoi(t)
		return i
	}
	return 0
}
