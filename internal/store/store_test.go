package store

import (
	"path/filepath"
	"testing"

	"poke-mngr/internal/config"
)

func TestStoreAccountsAndLimit(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "test.db")
	st, err := Open(dbPath)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	defer st.Close()

	for i := 1; i <= config.MaxAccounts; i++ {
		acc, err := st.AddAccount(config.AccountRecord{
			Nick:    "Player",
			Token:   "secret-token-123456",
			Enabled: true,
			Options: config.DefaultAccountOptions(),
		})
		if err != nil {
			t.Fatalf("AddAccount %d failed: %v", i, err)
		}
		if acc.UUID == "" || acc.DeviceID == "" {
			t.Fatalf("expected auto UUID and DeviceID")
		}
	}

	// 5th account must fail per ToS cap
	if _, err := st.AddAccount(config.AccountRecord{Nick: "Fifth", Token: "tok", Enabled: true}); err == nil {
		t.Fatalf("expected error on exceeding MaxAccounts")
	}

	list, err := st.ListAccounts()
	if err != nil || len(list) != config.MaxAccounts {
		t.Fatalf("expected %d accounts, got %d (err=%v)", config.MaxAccounts, len(list), err)
	}

	// Token update + redaction
	if err := st.UpdateAccountToken(list[0].ID, "new-renewed-token-999999"); err != nil {
		t.Fatalf("UpdateAccountToken: %v", err)
	}
	got, err := st.GetAccount(list[0].ID)
	if err != nil || got.Token != "new-renewed-token-999999" {
		t.Fatalf("expected updated token, got %+v", got)
	}
	red := got.Redacted()
	if red.Token != "" || red.TokenHint == "" {
		t.Fatalf("expected redacted token, got token=%q hint=%q", red.Token, red.TokenHint)
	}

	// Settings roundtrip
	gs := st.LoadGlobalSettings()
	gs.CardStyle = "medalhao"
	gs.ExternalLoginWaitMin = 12
	if err := st.SaveGlobalSettings(gs); err != nil {
		t.Fatalf("SaveGlobalSettings: %v", err)
	}
	gs2 := st.LoadGlobalSettings()
	if gs2.CardStyle != "medalhao" || gs2.ExternalLoginWaitMin != 12 {
		t.Fatalf("settings mismatch: %+v", gs2)
	}
}
