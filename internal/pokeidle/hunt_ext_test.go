package pokeidle

import (
	"archive/zip"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func buildTestXPI(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestHuntExtensionInstallAndScripts(t *testing.T) {
	dir := t.TempDir()
	ext := NewHuntExtensionWithDir(dir)

	xpi := buildTestXPI(t, map[string]string{
		"manifest.json": `{
			"name": "/hunt for PokeIdle",
			"version": "1.2.10",
			"content_scripts": [
				{
					"matches": ["https://pokeidle.io/*"],
					"css": ["styles/hunt.css"],
					"js": ["scripts/main.js"],
					"world": "MAIN"
				},
				{
					"matches": ["https://pokeidle.io/*"],
					"js": ["scripts/isolated-bridge.js"]
				}
			]
		}`,
		"styles/hunt.css":          `.pih-badge { color: gold; }`,
		"scripts/main.js":          `window.__pihLoaded = true;`,
		"scripts/isolated-bridge.js": `console.log("should not inject isolated world");`,
	})

	ver, err := ext.InstallFromXPI(xpi)
	if err != nil {
		t.Fatalf("InstallFromXPI failed: %v", err)
	}
	if ver != "1.2.10" {
		t.Fatalf("expected version 1.2.10, got %q", ver)
	}

	// Reload from disk into a fresh instance
	ext2 := NewHuntExtensionWithDir(dir)
	ext2.Load()
	st := ext2.Status(true)
	if !st.Installed || st.Version != "1.2.10" {
		t.Fatalf("expected loaded status v1.2.10, got %+v", st)
	}

	scripts := ext2.Scripts(true, "sec123")
	if len(scripts) != 3 {
		t.Fatalf("expected 3 scripts (css + main js + wishlist bridge), got %d", len(scripts))
	}
	joined := strings.Join(scripts, "\n")
	if !strings.Contains(joined, ".pih-badge") || !strings.Contains(joined, "__pihLoaded") {
		t.Fatalf("missing css or main js in scripts")
	}
	if strings.Contains(joined, "should not inject isolated world") {
		t.Fatalf("isolated world script should not be injected")
	}
	if !strings.Contains(joined, "/api/wishlist?s=sec123") {
		t.Fatalf("wishlist bridge missing secret endpoint")
	}
	if got := ext2.Scripts(false, "sec123"); len(got) != 0 {
		t.Fatalf("expected no scripts when disabled")
	}
}

func TestHuntExtensionZipSlipRejected(t *testing.T) {
	dir := t.TempDir()
	ext := NewHuntExtensionWithDir(dir)
	bad := buildTestXPI(t, map[string]string{
		"../evil.js": "alert(1)",
	})
	if _, err := ext.InstallFromXPI(bad); err == nil {
		t.Fatalf("expected zip-slip path to be rejected")
	}
}

func TestHuntExtensionWishlistFallback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/fail" {
			http.Error(w, "down", http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"itens":["Pikachu"]}`))
	}))
	defer srv.Close()

	ext := NewHuntExtensionWithDir(t.TempDir())
	ext.wishlistURLs = []string{srv.URL + "/fail", srv.URL + "/ok"}

	body, err := ext.FetchWishlist(context.Background())
	if err != nil {
		t.Fatalf("FetchWishlist failed: %v", err)
	}
	if !strings.Contains(string(body), "Pikachu") {
		t.Fatalf("unexpected wishlist body: %s", string(body))
	}
}

func TestCompareDotVersions(t *testing.T) {
	if compareDotVersions("1.0.19", "1.0.9") <= 0 {
		t.Fatalf("expected 1.0.19 > 1.0.9")
	}
	if compareDotVersions("1.1", "1.0.20") <= 0 {
		t.Fatalf("expected 1.1 > 1.0.20")
	}
	if compareDotVersions("1.2.3", "1.2.3") != 0 {
		t.Fatalf("expected 1.2.3 == 1.2.3")
	}
}
