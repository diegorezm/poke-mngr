package pokeidle

import (
	"archive/zip"
	"bytes"
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
		"styles/hunt.css":            `.pih-badge { color: gold; }`,
		"scripts/main.js":            `window.__pihLoaded = true;`,
		"scripts/isolated-bridge.js": `console.log("should not inject isolated world");`,
	})

	ver, err := ext.InstallFromXPI(xpi)
	if err != nil {
		t.Fatalf("InstallFromXPI failed: %v", err)
	}
	if ver != "1.2.10" {
		t.Fatalf("expected version 1.2.10, got %q", ver)
	}

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
