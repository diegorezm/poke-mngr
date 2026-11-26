package store

import (
	"encoding/json"
	"time"
)

type MarketRuleSpec struct {
	Target      string  `json:"target"`                // "item" | "pokemon"
	ItemID      int     `json:"itemId,omitempty"`
	ItemName    string  `json:"itemName,omitempty"`
	Query       string  `json:"query,omitempty"`       // pokemon search
	Elemento    string  `json:"elemento,omitempty"`    // pokemon type filter
	Moeda       string  `json:"moeda"`                 // "gold" | "orb"
	MaxPrice    int64   `json:"maxPrice"`
	MaxPctBelow float64 `json:"maxPctBelow,omitempty"` // alert/snipe when X% below 7d avg
	OnlyShiny   bool    `json:"onlyShiny,omitempty"`
	OnlyP5      bool    `json:"onlyP5,omitempty"`
	OnlyZMove   bool    `json:"onlyZMove,omitempty"`
	OnlyTmAoe   bool    `json:"onlyTmAoe,omitempty"`
	MinIV       int     `json:"minIv,omitempty"`
	MinLevel    int     `json:"minLevel,omitempty"`
	DailyBudget int64   `json:"dailyBudget,omitempty"` // per account per day
	AccountIDs  []int   `json:"accountIds,omitempty"`
}

type MarketRule struct {
	ID        int            `json:"id"`
	Kind      string         `json:"kind"` // "alert" | "snipe"
	Enabled   bool           `json:"enabled"`
	Spec      MarketRuleSpec `json:"spec"`
	Spent     int64          `json:"spent"`
	SpentDay  string         `json:"spentDay"`
	LastFire  int64          `json:"lastFire"`
	CreatedAt int64          `json:"createdAt"`
}

type MarketLogEntry struct {
	ID        int    `json:"id"`
	TS        int64  `json:"ts"`
	AccountID int    `json:"accountId"`
	RuleID    int    `json:"ruleId"`
	Status    string `json:"status"`
	Text      string `json:"text"`
}

type MarketSellRuleSpec struct {
	Target string `json:"target"` // "item" | "pokemon"
	Moeda  string `json:"moeda"`  // "gold" | "orb"

	// Item excess settings
	ItemID       int    `json:"itemId,omitempty"`
	ItemName     string `json:"itemName,omitempty"`
	KeepQty      int    `json:"keepQty,omitempty"`      // keep at least this many in bag
	MinSellQty   int    `json:"minSellQty,omitempty"`   // minimum excess lot to list
	MaxActiveAds int    `json:"maxActiveAds,omitempty"` // max simultaneous ads per item/account

	// Pokemon excess & protection settings
	Query         string  `json:"query,omitempty"`         // species name filter (empty = any)
	KeepBestCount int     `json:"keepBestCount,omitempty"` // keep top N per species by grade/IV
	ShinyMode     string  `json:"shinyMode,omitempty"`     // "no" | "only" | "any"
	AllowP5       bool    `json:"allowP5,omitempty"`
	AllowZMove    bool    `json:"allowZMove,omitempty"`
	AllowTmAoe    bool    `json:"allowTmAoe,omitempty"`
	MaxGrade      float64 `json:"maxGrade,omitempty"` // 0 = no cap
	MaxIV         int     `json:"maxIv,omitempty"`    // 0 = no cap
	MinLevel      int     `json:"minLevel,omitempty"` // 0 = server min
	MaxLevel      int     `json:"maxLevel,omitempty"` // 0 = no cap
	Days          int     `json:"days,omitempty"`     // 1..30 (pokemon stay duration)
	GoldFloor     int64   `json:"goldFloor,omitempty"`

	// Pricing settings
	PriceMode        string  `json:"priceMode"`                  // "smart" | "undercut" | "fixed"
	FixedPrice       int64   `json:"fixedPrice,omitempty"`       // used when priceMode == "fixed"
	MinPrice         int64   `json:"minPrice,omitempty"`         // hard minimum price floor
	MinPctOfAvg      float64 `json:"minPctOfAvg,omitempty"`      // smart mode floor % of 7d avg/median
	UndercutStep     int64   `json:"undercutStep,omitempty"`     // flat undercut amount
	UndercutPct      float64 `json:"undercutPct,omitempty"`      // % undercut below lowest valid listing
	BelowFloorAction string  `json:"belowFloorAction,omitempty"` // "hold" | "list_at_floor"

	// Auto-reprice settings
	RepriceEnabled    bool    `json:"repriceEnabled,omitempty"`
	RepriceMinDiffPct float64 `json:"repriceMinDiffPct,omitempty"` // min % diff to edit listing

	AccountIDs []int `json:"accountIds,omitempty"`
}

type MarketSellRule struct {
	ID        int                `json:"id"`
	Enabled   bool               `json:"enabled"`
	Spec      MarketSellRuleSpec `json:"spec"`
	Listed    int                `json:"listed"`
	LastFire  int64              `json:"lastFire"`
	CreatedAt int64              `json:"createdAt"`
}

func (s *Store) ListMarketRules() ([]MarketRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(`
		SELECT id, kind, enabled, spec_json, spent, spent_day, last_fire, created_at
		FROM market_rules
		ORDER BY id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MarketRule
	for rows.Next() {
		var r MarketRule
		var enabled int
		var specJSON string
		if err := rows.Scan(&r.ID, &r.Kind, &enabled, &specJSON, &r.Spent, &r.SpentDay, &r.LastFire, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.Enabled = enabled != 0
		_ = json.Unmarshal([]byte(specJSON), &r.Spec)
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) SaveMarketRule(r MarketRule) (MarketRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.Marshal(r.Spec)
	if err != nil {
		return r, err
	}
	en := 0
	if r.Enabled {
		en = 1
	}
	if r.ID == 0 {
		r.CreatedAt = time.Now().Unix()
		res, err := s.db.Exec(`
			INSERT INTO market_rules(kind, enabled, spec_json, spent, spent_day, last_fire, created_at)
			VALUES (?, ?, ?, 0, '', 0, ?)
		`, r.Kind, en, string(b), r.CreatedAt)
		if err != nil {
			return r, err
		}
		id, _ := res.LastInsertId()
		r.ID = int(id)
		return r, nil
	}
	_, err = s.db.Exec(`
		UPDATE market_rules SET kind = ?, enabled = ?, spec_json = ? WHERE id = ?
	`, r.Kind, en, string(b), r.ID)
	return r, err
}

func (s *Store) ToggleMarketRule(id int) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var en int
	if err := s.db.QueryRow(`SELECT enabled FROM market_rules WHERE id = ?`, id).Scan(&en); err != nil {
		return false, err
	}
	next := 1
	if en != 0 {
		next = 0
	}
	_, err := s.db.Exec(`UPDATE market_rules SET enabled = ? WHERE id = ?`, next, id)
	return next != 0, err
}

func (s *Store) DeleteMarketRule(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM market_rules WHERE id = ?`, id)
	return err
}

func (s *Store) GetRuleDailySpend(ruleID, accountID int, day string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	var spent int64
	_ = s.db.QueryRow(`SELECT spent FROM market_rule_spend WHERE rule_id = ? AND account_id = ? AND day = ?`,
		ruleID, accountID, day).Scan(&spent)
	return spent
}

func (s *Store) AddRuleDailySpend(ruleID, accountID int, day string, delta int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		INSERT INTO market_rule_spend(rule_id, account_id, day, spent)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(rule_id, account_id, day) DO UPDATE SET spent = spent + excluded.spent
	`, ruleID, accountID, day, delta)
	if err != nil {
		return err
	}
	_, _ = s.db.Exec(`UPDATE market_rules SET last_fire = ?, spent = spent + ?, spent_day = ? WHERE id = ?`,
		time.Now().Unix(), delta, day, ruleID)
	return nil
}

func (s *Store) AppendMarketLog(accountID, ruleID int, status, text string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`
		INSERT INTO market_log(ts, account_id, rule_id, status, text)
		VALUES (?, ?, ?, ?, ?)
	`, time.Now().Unix(), accountID, ruleID, status, text)
	if err != nil {
		return err
	}
	_, _ = s.db.Exec(`DELETE FROM market_log WHERE id NOT IN (SELECT id FROM market_log ORDER BY id DESC LIMIT 300)`)
	return nil
}

func (s *Store) ListMarketLog(limit int) ([]MarketLogEntry, error) {
	if limit <= 0 {
		limit = 100
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(`SELECT id, ts, account_id, rule_id, status, text FROM market_log ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MarketLogEntry
	for rows.Next() {
		var e MarketLogEntry
		if err := rows.Scan(&e.ID, &e.TS, &e.AccountID, &e.RuleID, &e.Status, &e.Text); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// --- Auto-Sell Rules ---

func (s *Store) ListMarketSellRules() ([]MarketSellRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(`
		SELECT id, enabled, spec_json, listed, last_fire, created_at
		FROM market_sell_rules
		ORDER BY id DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MarketSellRule
	for rows.Next() {
		var r MarketSellRule
		var enabled int
		var specJSON string
		if err := rows.Scan(&r.ID, &enabled, &specJSON, &r.Listed, &r.LastFire, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.Enabled = enabled != 0
		_ = json.Unmarshal([]byte(specJSON), &r.Spec)
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *Store) SaveMarketSellRule(r MarketSellRule) (MarketSellRule, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.Marshal(r.Spec)
	if err != nil {
		return r, err
	}
	en := 0
	if r.Enabled {
		en = 1
	}
	if r.ID == 0 {
		r.CreatedAt = time.Now().Unix()
		res, err := s.db.Exec(`
			INSERT INTO market_sell_rules(enabled, spec_json, listed, last_fire, created_at)
			VALUES (?, ?, 0, 0, ?)
		`, en, string(b), r.CreatedAt)
		if err != nil {
			return r, err
		}
		id, _ := res.LastInsertId()
		r.ID = int(id)
		return r, nil
	}
	_, err = s.db.Exec(`
		UPDATE market_sell_rules SET enabled = ?, spec_json = ? WHERE id = ?
	`, en, string(b), r.ID)
	return r, err
}

func (s *Store) ToggleMarketSellRule(id int) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var en int
	if err := s.db.QueryRow(`SELECT enabled FROM market_sell_rules WHERE id = ?`, id).Scan(&en); err != nil {
		return false, err
	}
	next := 1
	if en != 0 {
		next = 0
	}
	_, err := s.db.Exec(`UPDATE market_sell_rules SET enabled = ? WHERE id = ?`, next, id)
	return next != 0, err
}

func (s *Store) DeleteMarketSellRule(id int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`DELETE FROM market_sell_rules WHERE id = ?`, id)
	return err
}

func (s *Store) RecordSellRuleFire(id int, delta int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.Exec(`UPDATE market_sell_rules SET listed = listed + ?, last_fire = ? WHERE id = ?`,
		delta, time.Now().Unix(), id)
	return err
}
