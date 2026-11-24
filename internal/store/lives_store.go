package store

import (
	"database/sql"
	"encoding/json"
	"errors"
)

type LivesAccountConfig struct {
	Enabled     bool     `json:"enabled"`
	AutoRedeem  bool     `json:"autoRedeem"`
	Reward      string   `json:"reward"` // "xp" | "capture" | "lure"
	ClaimChest  bool     `json:"claimChest"`
	TwitchSlot1 string   `json:"twitchSlot1"` // "" = auto | "none" | channel
	TwitchSlot2 string   `json:"twitchSlot2"`
	KickSlot1   string   `json:"kickSlot1"`
	KickSlot2   string   `json:"kickSlot2"`
	ExtraTwitch []string `json:"extraTwitch"`
	ExtraKick   []string `json:"extraKick"`
}

func DefaultLivesAccountConfig() LivesAccountConfig {
	return LivesAccountConfig{
		Enabled:    false,
		AutoRedeem: false,
		Reward:     "xp",
		ClaimChest: true,
	}
}

type LivesLogEntry struct {
	ID        int    `json:"id"`
	TS        int64  `json:"ts"`
	AccountID int    `json:"accountId"`
	Site      string `json:"site"`
	Channel   string `json:"channel"`
	Kind      string `json:"kind"`
	Message   string `json:"message"`
}

func (s *Store) LoadLivesConfig(accountID int) LivesAccountConfig {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg := DefaultLivesAccountConfig()
	var raw string
	err := s.db.QueryRow(`SELECT config_json FROM lives_config WHERE account_id = ?`, accountID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) || err != nil || raw == "" {
		return cfg
	}
	_ = json.Unmarshal([]byte(raw), &cfg)
	if cfg.Reward == "" {
		cfg.Reward = "xp"
	}
	return cfg
}

func (s *Store) SaveLivesConfig(accountID int, cfg LivesAccountConfig) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`
		INSERT INTO lives_config(account_id, config_json)
		VALUES (?, ?)
		ON CONFLICT(account_id) DO UPDATE SET config_json = excluded.config_json
	`, accountID, string(b))
	return err
}

func (s *Store) ListLivesLog(limit int) ([]LivesLogEntry, error) {
	if limit <= 0 {
		limit = 200
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	rows, err := s.db.Query(`
		SELECT id, ts, account_id, site, channel, kind, message
		FROM lives_log
		ORDER BY id DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LivesLogEntry
	for rows.Next() {
		var e LivesLogEntry
		if err := rows.Scan(&e.ID, &e.TS, &e.AccountID, &e.Site, &e.Channel, &e.Kind, &e.Message); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
