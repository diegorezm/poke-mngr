package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
)

func TestParseAndCompareVersions(t *testing.T) {
	v1, ok := ParseVersion("v0.2.10")
	if !ok || v1 != [3]int{0, 2, 10} {
		t.Fatalf("unexpected parse v0.2.10: %v %v", v1, ok)
	}
	v2, ok := ParseVersion("0.2.9")
	if !ok || CompareVersions(v1, v2) <= 0 {
		t.Fatalf("expected 0.2.10 > 0.2.9")
	}
	if _, ok := ParseVersion("v1.0.0-beta"); ok {
		t.Fatalf("prerelease tag should be rejected")
	}
}

func TestParseSHA256Sums(t *testing.T) {
	sum := strings.Repeat("a", 64)
	body := strings.Repeat("b", 64) + "  other.zip\n" + sum + " *poke-mngr-amd64-installer.exe\n"
	got := parseSHA256Sums(strings.NewReader(body), "poke-mngr-amd64-installer.exe")
	if got != sum {
		t.Fatalf("expected %s, got %q", sum, got)
	}
}

func TestUpdaterCheckAndSHA256Mismatch(t *testing.T) {
	payload := []byte("fake-nsis-binary-content")
	realSum := sha256.Sum256(payload)
	realHex := hex.EncodeToString(realSum[:])
	wrongHex := strings.Repeat("f", 64)

	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/test/poke-mngr/releases/latest":
			if r.Header.Get("If-None-Match") == `"etag-1"` {
				w.WriteHeader(http.StatusNotModified)
				return
			}
			w.Header().Set("ETag", `"etag-1"`)
			_ = json.NewEncoder(w).Encode(releasePayload{
				TagName: "v0.9.0",
				HTMLURL: srv.URL + "/releases/tag/v0.9.0",
				Body:    "Novidades incríveis",
				Assets: []releaseAsset{
					{
						Name:               "poke-mngr-amd64-installer.exe",
						BrowserDownloadURL: srv.URL + "/releases/download/v0.9.0/poke-mngr-amd64-installer.exe",
						Digest:             "sha256:" + wrongHex,
					},
				},
			})
		case "/releases/download/v0.9.0/poke-mngr-amd64-installer.exe":
			_, _ = w.Write(payload)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	u := &Updater{
		repo:         "test/poke-mngr",
		apiBase:      srv.URL,
		downloadBase: srv.URL + "/releases/download/",
		current:      "0.1.0",
		enabled:      true,
		isDev:        false,
		httpCli:      srv.Client(),
	}

	st := u.Check(context.Background())
	if !st.Available || st.Latest != "0.9.0" || st.Error != "" {
		t.Fatalf("expected v0.9.0 available, got %+v", st)
	}
	if st.InstallerName != "poke-mngr-amd64-installer.exe" {
		t.Fatalf("expected installer asset detected, got %q", st.InstallerName)
	}

	// Second check should hit 304 ETag
	st2 := u.Check(context.Background())
	if !st2.Available || st2.Error != "" {
		t.Fatalf("expected cached ETag check ok, got %+v", st2)
	}

	// On Windows, Apply must abort on SHA-256 mismatch before executing anything
	if runtime.GOOS == "windows" {
		_, err := u.Apply(context.Background())
		if err == nil || !strings.Contains(err.Error(), "SHA-256") {
			t.Fatalf("expected SHA-256 mismatch error (real=%s), got %v", realHex, err)
		}
	}

	// Dev mode must report CanApply=false
	u.isDev = true
	stDev := u.State()
	if stDev.CanApply || stDev.CannotApplyReason == "" {
		t.Fatalf("expected CanApply=false in dev mode, got %+v", stDev)
	}

	// Missing SHA-256 (neither digest nor SHA256SUMS.txt) must be rejected before executing
	if runtime.GOOS == "windows" {
		u.isDev = false
		u.installerSHA256 = ""
		u.checksumURL = ""
		_, err := u.Apply(context.Background())
		if err == nil || !strings.Contains(err.Error(), "SHA-256") {
			t.Fatalf("expected missing SHA-256 rejection error, got %v", err)
		}
	}
}
