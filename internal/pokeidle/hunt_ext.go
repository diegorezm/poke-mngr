package pokeidle

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"poke-mngr/internal/config"
)

const (
	huntAddonAPI     = "https://addons.mozilla.org/api/v5/addons/addon/hunt-for-pokeidle/"
	huntAddonPrefix  = "https://addons.mozilla.org/"
	huntMaxXPIBytes  = 20 * 1024 * 1024
	wishlistCacheTTL = 5 * time.Minute
)

var huntWishlistURLs = []string{
	"https://pokeidleguide.io/api/wishlist",
	"https://pokeidle-gg.pages.dev/api/wishlist",
}

type huntManifest struct {
	Name           string              `json:"name"`
	Version        string              `json:"version"`
	ContentScripts []huntContentScript `json:"content_scripts"`
}

type huntContentScript struct {
	Matches []string `json:"matches"`
	JS      []string `json:"js"`
	CSS     []string `json:"css"`
	World   string   `json:"world"`
}

type huntBundle struct {
	Version string
	Scripts []string
}

type HuntExtStatus struct {
	Enabled   bool   `json:"enabled"`
	Installed bool   `json:"installed"`
	Version   string `json:"version"`
	Error     string `json:"error,omitempty"`
}

// HuntExtension manages the optional "/hunt for PokeIdle" browser extension (published on AMO).
// The extension code is not bundled with PokeMngr; when the user enables it, PokeMngr downloads
// the signed .xpi from addons.mozilla.org, caches it under DataDir/extensions/hunt-for-pokeidle,
// injects its CSS/JS into /app via BridgeHub, and proxies /api/wishlist same-origin.
type HuntExtension struct {
	mu           sync.RWMutex
	installMu    sync.Mutex
	rootDir      string
	addonAPI     string
	addonPrefix  string
	wishlistURLs []string
	httpCli      *http.Client
	bundle       *huntBundle
	lastErr      string

	wishMu    sync.RWMutex
	wishBody  []byte
	wishAt    time.Time
}

func NewHuntExtension() *HuntExtension {
	return NewHuntExtensionWithDir(filepath.Join(config.DataDir(), "extensions", "hunt-for-pokeidle"))
}

func NewHuntExtensionWithDir(rootDir string) *HuntExtension {
	return &HuntExtension{
		rootDir:      rootDir,
		addonAPI:     huntAddonAPI,
		addonPrefix:  huntAddonPrefix,
		wishlistURLs: append([]string(nil), huntWishlistURLs...),
		httpCli:      &http.Client{Timeout: 30 * time.Second},
	}
}

// Load scans rootDir for the newest valid installed version of /hunt.
func (h *HuntExtension) Load() {
	entries, err := os.ReadDir(h.rootDir)
	if err != nil {
		return
	}
	var newest *huntBundle
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		b, err := readHuntBundle(filepath.Join(h.rootDir, entry.Name()))
		if err != nil {
			continue
		}
		if newest == nil || compareDotVersions(b.Version, newest.Version) > 0 {
			newest = b
		}
	}
	h.mu.Lock()
	h.bundle = newest
	h.mu.Unlock()
}

func (h *HuntExtension) Status(enabled bool) HuntExtStatus {
	h.mu.RLock()
	defer h.mu.RUnlock()
	st := HuntExtStatus{
		Enabled: enabled,
		Error:   h.lastErr,
	}
	if h.bundle != nil {
		st.Installed = true
		st.Version = h.bundle.Version
	}
	return st
}

func (h *HuntExtension) InstalledVersion() string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	if h.bundle == nil {
		return ""
	}
	return h.bundle.Version
}

// Scripts returns the CSS/JS snippets (plus wishlist postMessage bridge) ready to inject into /app.
func (h *HuntExtension) Scripts(enabled bool, bridgeSecret string) []string {
	if !enabled {
		return nil
	}
	h.mu.RLock()
	b := h.bundle
	h.mu.RUnlock()
	if b == nil || len(b.Scripts) == 0 {
		return nil
	}
	out := make([]string, 0, len(b.Scripts)+1)
	out = append(out, b.Scripts...)
	out = append(out, buildWishlistBridgeJS(bridgeSecret))
	return out
}

// InstallOrUpdate fetches the latest release from AMO and installs it if newer than local.
func (h *HuntExtension) InstallOrUpdate(ctx context.Context) (string, error) {
	h.installMu.Lock()
	defer h.installMu.Unlock()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.addonAPI, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "PokeMngr/1.0")
	resp, err := h.httpCli.Do(req)
	if err != nil {
		h.setErr(err.Error())
		return "", fmt.Errorf("consultar AMO: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		err := fmt.Errorf("loja Firefox respondeu HTTP %d", resp.StatusCode)
		h.setErr(err.Error())
		return "", err
	}

	var info struct {
		CurrentVersion struct {
			Version string `json:"version"`
			File    struct {
				URL string `json:"url"`
			} `json:"file"`
		} `json:"current_version"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(&info); err != nil {
		h.setErr(err.Error())
		return "", fmt.Errorf("ler resposta da loja: %w", err)
	}
	version := strings.TrimSpace(info.CurrentVersion.Version)
	fileURL := strings.TrimSpace(info.CurrentVersion.File.URL)
	if version == "" || fileURL == "" {
		err := fmt.Errorf("resposta da loja sem versão ou arquivo")
		h.setErr(err.Error())
		return "", err
	}
	if h.addonPrefix != "" && !strings.HasPrefix(fileURL, h.addonPrefix) {
		err := fmt.Errorf("endereço inesperado para extensão: %s", fileURL)
		h.setErr(err.Error())
		return "", err
	}

	if cur := h.InstalledVersion(); cur != "" && compareDotVersions(cur, version) >= 0 {
		h.setErr("")
		return cur, nil
	}

	dlReq, err := http.NewRequestWithContext(ctx, http.MethodGet, fileURL, nil)
	if err != nil {
		h.setErr(err.Error())
		return "", err
	}
	dlReq.Header.Set("User-Agent", "PokeMngr/1.0")
	dlResp, err := h.httpCli.Do(dlReq)
	if err != nil {
		h.setErr(err.Error())
		return "", fmt.Errorf("baixar .xpi: %w", err)
	}
	defer dlResp.Body.Close()
	if dlResp.StatusCode != http.StatusOK {
		err := fmt.Errorf("download .xpi falhou (HTTP %d)", dlResp.StatusCode)
		h.setErr(err.Error())
		return "", err
	}
	xpiBytes, err := io.ReadAll(io.LimitReader(dlResp.Body, huntMaxXPIBytes+1))
	if err != nil {
		h.setErr(err.Error())
		return "", fmt.Errorf("ler .xpi: %w", err)
	}
	if len(xpiBytes) > huntMaxXPIBytes {
		err := fmt.Errorf("arquivo .xpi maior que o limite de 20 MB")
		h.setErr(err.Error())
		return "", err
	}

	installedVer, err := h.InstallFromXPI(xpiBytes)
	if err != nil {
		h.setErr(err.Error())
		return "", err
	}
	h.setErr("")
	return installedVer, nil
}

// InstallFromXPI validates, extracts, and activates a .xpi archive in rootDir.
func (h *HuntExtension) InstallFromXPI(xpiBytes []byte) (string, error) {
	if err := os.MkdirAll(h.rootDir, 0o700); err != nil {
		return "", fmt.Errorf("criar pasta da extensão: %w", err)
	}
	staging := filepath.Join(h.rootDir, fmt.Sprintf(".staging-%d", time.Now().UnixNano()))
	_ = os.RemoveAll(staging)
	defer os.RemoveAll(staging)

	if err := unzipSafe(xpiBytes, staging); err != nil {
		return "", fmt.Errorf("extrair .xpi: %w", err)
	}
	bundle, err := readHuntBundle(staging)
	if err != nil {
		return "", err
	}
	safeVer := sanitizeVersionDir(bundle.Version)
	if safeVer == "" {
		return "", fmt.Errorf("versão inválida no manifest: %q", bundle.Version)
	}
	target := filepath.Join(h.rootDir, safeVer)
	_ = os.RemoveAll(target)
	if err := os.Rename(staging, target); err != nil {
		return "", fmt.Errorf("ativar extensão: %w", err)
	}

	// Clean older versions
	if entries, err := os.ReadDir(h.rootDir); err == nil {
		for _, entry := range entries {
			full := filepath.Join(h.rootDir, entry.Name())
			if full != target {
				_ = os.RemoveAll(full)
			}
		}
	}

	h.mu.Lock()
	h.bundle = bundle
	h.lastErr = ""
	h.mu.Unlock()
	return bundle.Version, nil
}

// UpdateLater refreshes the installed /hunt bundle in the background if enabled.
func (h *HuntExtension) UpdateLater(ctx context.Context, enabled bool) {
	if !enabled {
		return
	}
	go func() {
		uCtx, cancel := context.WithTimeout(ctx, 35*time.Second)
		defer cancel()
		if ver, err := h.InstallOrUpdate(uCtx); err != nil {
			log.Printf("[hunt-ext] não conferiu atualização: %v", err)
		} else {
			log.Printf("[hunt-ext] /hunt pronto (v%s)", ver)
		}
	}()
}

// FetchWishlist fetches the public Shiny WishList JSON with a 5-minute cache and dual-origin fallback.
func (h *HuntExtension) FetchWishlist(ctx context.Context) ([]byte, error) {
	h.wishMu.RLock()
	if len(h.wishBody) > 0 && time.Since(h.wishAt) < wishlistCacheTTL {
		body := append([]byte(nil), h.wishBody...)
		h.wishMu.RUnlock()
		return body, nil
	}
	h.wishMu.RUnlock()

	var lastErr error
	for _, rawURL := range h.wishlistURLs {
		reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
		if err != nil {
			cancel()
			lastErr = err
			continue
		}
		req.Header.Set("User-Agent", "PokeMngr/1.0")
		resp, err := h.httpCli.Do(req)
		if err != nil {
			cancel()
			lastErr = err
			continue
		}
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
		resp.Body.Close()
		cancel()
		if readErr != nil {
			lastErr = readErr
			continue
		}
		if resp.StatusCode != http.StatusOK {
			lastErr = fmt.Errorf("HTTP %d em %s", resp.StatusCode, rawURL)
			continue
		}
		if !json.Valid(body) {
			lastErr = fmt.Errorf("JSON inválido em %s", rawURL)
			continue
		}
		h.wishMu.Lock()
		h.wishBody = append([]byte(nil), body...)
		h.wishAt = time.Now()
		h.wishMu.Unlock()
		return body, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("nenhuma URL de wishlist configurada")
	}
	return nil, lastErr
}

func (h *HuntExtension) setErr(msg string) {
	h.mu.Lock()
	h.lastErr = msg
	h.mu.Unlock()
}

func readHuntBundle(dir string) (*huntBundle, error) {
	manifestRaw, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return nil, fmt.Errorf("ler manifest.json: %w", err)
	}
	var m huntManifest
	if err := json.Unmarshal(manifestRaw, &m); err != nil {
		return nil, fmt.Errorf("parse manifest.json: %w", err)
	}
	if !strings.Contains(strings.ToLower(m.Name), "hunt") {
		return nil, fmt.Errorf("extensão inesperada: %s", m.Name)
	}

	absRoot, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	readRel := func(rel string) (string, error) {
		target := filepath.Join(absRoot, filepath.FromSlash(rel))
		absTarget, err := filepath.Abs(target)
		if err != nil {
			return "", err
		}
		if !strings.HasPrefix(absTarget, absRoot+string(os.PathSeparator)) {
			return "", fmt.Errorf("caminho inválido no manifest: %s", rel)
		}
		b, err := os.ReadFile(absTarget)
		if err != nil {
			return "", fmt.Errorf("%s: %w", rel, err)
		}
		return string(b), nil
	}

	hasMainWorld := false
	for _, cs := range m.ContentScripts {
		if matchesPokeIdle(cs.Matches) && strings.EqualFold(cs.World, "MAIN") {
			hasMainWorld = true
			break
		}
	}

	var scripts []string
	for _, cs := range m.ContentScripts {
		if !matchesPokeIdle(cs.Matches) {
			continue
		}
		for _, cssFile := range cs.CSS {
			cssContent, err := readRel(cssFile)
			if err != nil {
				return nil, err
			}
			cssJSON, _ := json.Marshal(cssContent)
			scripts = append(scripts, fmt.Sprintf(`(function(){
  var s = document.createElement('style');
  s.dataset.deck = 'hunt';
  s.textContent = %s;
  var add = function(){ (document.head || document.documentElement).appendChild(s); };
  if (document.head || document.documentElement) { add(); return; }
  new MutationObserver(function(_, o){
    if (document.head || document.documentElement) { o.disconnect(); add(); }
  }).observe(document, { childList: true });
})();`, string(cssJSON)))
		}
		// Inject MAIN world scripts (isolated world is only the browser wishlist bridge,
		// which we replace with buildWishlistBridgeJS). If an archive has no MAIN marker,
		// fall back to injecting its JS directly.
		if strings.EqualFold(cs.World, "MAIN") || (!hasMainWorld && cs.World == "") {
			for _, jsFile := range cs.JS {
				jsContent, err := readRel(jsFile)
				if err != nil {
					return nil, err
				}
				scripts = append(scripts, fmt.Sprintf("if (window.__pokeMngrBridgeInstalled) {\n%s\n}", jsContent))
			}
		}
	}

	if len(scripts) == 0 {
		return nil, fmt.Errorf("extensão /hunt não contém scripts para pokeidle.io")
	}
	return &huntBundle{
		Version: strings.TrimSpace(m.Version),
		Scripts: scripts,
	}, nil
}

func matchesPokeIdle(patterns []string) bool {
	for _, p := range patterns {
		if strings.Contains(strings.ToLower(p), "pokeidle.io") {
			return true
		}
	}
	return false
}

func buildWishlistBridgeJS(secret string) string {
	endpoint := "/api/wishlist"
	if secret != "" {
		endpoint += "?s=" + secret
	}
	epJSON, _ := json.Marshal(endpoint)
	return fmt.Sprintf(`(function() {
  if (window.__pokeMngrWishlistBridge) return;
  window.__pokeMngrWishlistBridge = true;
  var ENDPOINT = %s;
  window.addEventListener('message', function(ev) {
    if (ev.source !== window || !ev.data || ev.data.tipo !== 'pih:wishlist:pedir') return;
    var reqId = ev.data.id;
    var reply = function(body) {
      var payload = Object.assign({ tipo: 'pih:wishlist:lista', id: reqId }, body);
      window.postMessage(payload, location.origin);
    };
    fetch(ENDPOINT, { cache: 'no-store' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(dados) { reply({ dados: dados }); })
      .catch(function(err) { reply({ erro: String(err) }); });
  });
})();`, string(epJSON))
}

func unzipSafe(data []byte, dest string) error {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dest, 0o700); err != nil {
		return err
	}
	absDest, err := filepath.Abs(dest)
	if err != nil {
		return err
	}
	var totalWritten int64
	const maxUncompressed = 50 * 1024 * 1024

	for _, f := range zr.File {
		name := filepath.Clean(filepath.FromSlash(f.Name))
		if name == "." || name == "" || strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			return fmt.Errorf("entrada inválida no .xpi: %s", f.Name)
		}
		target := filepath.Join(absDest, name)
		absTarget, err := filepath.Abs(target)
		if err != nil {
			return err
		}
		if !strings.HasPrefix(absTarget, absDest+string(os.PathSeparator)) {
			return fmt.Errorf("caminho fora da pasta destino: %s", f.Name)
		}
		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(absTarget, 0o700); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(absTarget), 0o700); err != nil {
			return err
		}
		rc, err := f.Open()
		if err != nil {
			return err
		}
		out, err := os.Create(absTarget)
		if err != nil {
			rc.Close()
			return err
		}
		n, copyErr := io.Copy(out, io.LimitReader(rc, maxUncompressed-totalWritten+1))
		closeErr := out.Close()
		rc.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		totalWritten += n
		if totalWritten > maxUncompressed {
			return fmt.Errorf("conteúdo descompactado excede limite de 50 MB")
		}
	}
	return nil
}

func compareDotVersions(a, b string) int {
	pa := strings.Split(strings.TrimPrefix(strings.TrimSpace(a), "v"), ".")
	pb := strings.Split(strings.TrimPrefix(strings.TrimSpace(b), "v"), ".")
	n := len(pa)
	if len(pb) > n {
		n = len(pb)
	}
	for i := 0; i < n; i++ {
		var va, vb uint64
		if i < len(pa) {
			va, _ = strconv.ParseUint(pa[i], 10, 64)
		}
		if i < len(pb) {
			vb, _ = strconv.ParseUint(pb[i], 10, 64)
		}
		if va < vb {
			return -1
		}
		if va > vb {
			return 1
		}
	}
	return 0
}

func sanitizeVersionDir(v string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(v) {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || r == '.' || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if out == "" || out == "." || out == ".." {
		return ""
	}
	return out
}
