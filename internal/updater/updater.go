package updater

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Version and DefaultRepo are overridden at release build time via -ldflags:
//
//	-X poke-mngr/internal/updater.Version=0.2.0
//	-X poke-mngr/internal/updater.DefaultRepo=owner/poke-mngr
var (
	Version     = "1.0.0"
	DefaultRepo = "diegorezm/poke-mngr"
)

const (
	checkInterval     = time.Hour
	initialCheckDelay = 20 * time.Second
	maxInstallerBytes = 250 * 1024 * 1024
	maxNotesLen       = 4000
)

var (
	tagRe    = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)$`)
	sha256Re = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
)

// State is the public update snapshot sent to the frontend.
type State struct {
	Enabled           bool   `json:"enabled"`
	Repo              string `json:"repo"`
	Current           string `json:"current"`
	Latest            string `json:"latest"`
	Available         bool   `json:"available"`
	Notes             string `json:"notes"`
	URL               string `json:"url"`
	InstallerName     string `json:"installerName,omitempty"`
	CheckedAt         int64  `json:"checkedAt"` // unix ms (0 = never checked)
	Error             string `json:"error,omitempty"`
	CanApply          bool   `json:"canApply"`
	CannotApplyReason string `json:"cannotApplyReason,omitempty"`
	Step              string `json:"step,omitempty"`
	DoneMessage       string `json:"doneMessage,omitempty"`
}

type ApplyResult struct {
	OK         bool   `json:"ok"`
	Restarting bool   `json:"restarting"`
	Message    string `json:"message"`
}

type releasePayload struct {
	TagName string         `json:"tag_name"`
	HTMLURL string         `json:"html_url"`
	Body    string         `json:"body"`
	Assets  []releaseAsset `json:"assets"`
}

type releaseAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Digest             string `json:"digest"`
	Size               int64  `json:"size"`
}

// Updater checks GitHub Releases, verifies SHA-256, and triggers the Windows NSIS installer.
type Updater struct {
	mu           sync.RWMutex
	applyMu      sync.Mutex
	repo         string
	apiBase      string
	downloadBase string
	current      string
	enabled      bool
	isDev        bool
	httpCli      *http.Client
	onBeforeExit func()

	etag            string
	latest          string
	notes           string
	releaseURL      string
	installerName   string
	installerURL    string
	installerSHA256 string
	checksumURL     string
	checkedAt       int64
	lastErr         string
	step            string
	doneMsg         string
}

func New(onBeforeExit func()) *Updater {
	repo := strings.TrimSpace(os.Getenv("POKE_MNGR_UPDATE_REPO"))
	if repo == "" {
		repo = DefaultRepo
	}
	enabled := strings.TrimSpace(os.Getenv("UPDATE_CHECK")) != "0"
	isDev := strings.TrimSpace(os.Getenv("FRONTEND_DEVSERVER_URL")) != ""
	return &Updater{
		repo:         repo,
		apiBase:      "https://api.github.com",
		downloadBase: "https://github.com/" + repo + "/releases/download/",
		current:      strings.TrimPrefix(strings.TrimSpace(Version), "v"),
		enabled:      enabled,
		isDev:        isDev,
		httpCli:      &http.Client{Timeout: 20 * time.Second},
		onBeforeExit: onBeforeExit,
	}
}

// ParseVersion parses a strict semantic version (vX.Y.Z or X.Y.Z).
func ParseVersion(s string) ([3]int, bool) {
	m := tagRe.FindStringSubmatch(strings.TrimSpace(s))
	if m == nil {
		return [3]int{}, false
	}
	maj, err1 := strconv.Atoi(m[1])
	min, err2 := strconv.Atoi(m[2])
	pat, err3 := strconv.Atoi(m[3])
	if err1 != nil || err2 != nil || err3 != nil {
		return [3]int{}, false
	}
	return [3]int{maj, min, pat}, true
}

// CompareVersions returns >0 if a > b, <0 if a < b, 0 if equal.
func CompareVersions(a, b [3]int) int {
	for i := 0; i < 3; i++ {
		if a[i] != b[i] {
			if a[i] > b[i] {
				return 1
			}
			return -1
		}
	}
	return 0
}

func (u *Updater) Start(ctx context.Context) {
	if !u.enabled {
		log.Printf("[updater] verificação desligada (UPDATE_CHECK=0)")
		return
	}
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(initialCheckDelay):
		}
		for {
			st := u.Check(ctx)
			if st.Available {
				log.Printf("[updater] nova versão disponível: v%s (atual v%s)", st.Latest, st.Current)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(checkInterval):
			}
		}
	}()
}

func (u *Updater) State() State {
	u.mu.RLock()
	defer u.mu.RUnlock()
	return u.stateLocked()
}

func (u *Updater) stateLocked() State {
	avail := u.isAvailableLocked()
	canApply, reason := u.applyCapabilityLocked()
	return State{
		Enabled:           u.enabled,
		Repo:              u.repo,
		Current:           u.current,
		Latest:            u.latest,
		Available:         avail,
		Notes:             u.notes,
		URL:               u.releaseURL,
		InstallerName:     u.installerName,
		CheckedAt:         u.checkedAt,
		Error:             u.lastErr,
		CanApply:          canApply,
		CannotApplyReason: reason,
		Step:              u.step,
		DoneMessage:       u.doneMsg,
	}
}

func (u *Updater) isAvailableLocked() bool {
	if u.latest == "" {
		return false
	}
	lat, ok1 := ParseVersion(u.latest)
	cur, ok2 := ParseVersion(u.current)
	if !ok1 || !ok2 {
		return false
	}
	return CompareVersions(lat, cur) > 0
}

func (u *Updater) applyCapabilityLocked() (bool, string) {
	if !u.enabled {
		return false, "A verificação de atualizações está desligada (UPDATE_CHECK=0)."
	}
	if u.isDev {
		return false, "Em modo desenvolvimento (task dev), atualize via git pull ou baixe na página da Release."
	}
	if runtime.GOOS != "windows" {
		return false, "A instalação automática silenciosa está disponível apenas no Windows. Baixe pela página da Release."
	}
	if u.installerURL == "" {
		return false, "O instalador NSIS desta Release ainda não foi publicado. Baixe pela página da Release."
	}
	return true, ""
}

// Check queries GitHub Releases and updates internal state. Errors are stored in State.Error.
func (u *Updater) Check(ctx context.Context) State {
	if !u.enabled {
		return u.State()
	}

	u.mu.RLock()
	apiURL := strings.TrimRight(u.apiBase, "/") + "/repos/" + u.repo + "/releases/latest"
	etag := u.etag
	ua := "PokeMngr/" + u.current
	u.mu.RUnlock()

	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, apiURL, nil)
	if err != nil {
		u.setCheckError(fmt.Sprintf("URL inválida: %v", err))
		return u.State()
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", ua)
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}

	resp, err := u.httpCli.Do(req)
	if err != nil {
		u.setCheckError("Não consegui consultar o GitHub (verifique sua conexão).")
		return u.State()
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusNotModified:
		u.mu.Lock()
		u.lastErr = ""
		u.checkedAt = time.Now().UnixMilli()
		st := u.stateLocked()
		u.mu.Unlock()
		return st
	case http.StatusNotFound:
		u.setCheckError("Nenhuma Release publicada ainda neste repositório.")
		return u.State()
	case http.StatusOK:
		var rel releasePayload
		if err := json.NewDecoder(io.LimitReader(resp.Body, 2*1024*1024)).Decode(&rel); err != nil {
			u.setCheckError("Resposta inválida do GitHub Releases.")
			return u.State()
		}
		if err := u.ingestRelease(&rel, resp.Header.Get("ETag")); err != nil {
			u.setCheckError(err.Error())
		}
		return u.State()
	default:
		u.setCheckError(fmt.Sprintf("O GitHub respondeu HTTP %d. Tente novamente mais tarde.", resp.StatusCode))
		return u.State()
	}
}

func (u *Updater) setCheckError(msg string) {
	u.mu.Lock()
	u.lastErr = msg
	u.checkedAt = time.Now().UnixMilli()
	u.mu.Unlock()
}

func (u *Updater) ingestRelease(rel *releasePayload, etag string) error {
	tag := strings.TrimSpace(rel.TagName)
	if _, ok := ParseVersion(tag); !ok {
		return fmt.Errorf("a última Release tem um nome de versão inesperado (%q)", tag)
	}
	latest := strings.TrimPrefix(tag, "v")
	notes := strings.TrimSpace(rel.Body)
	if len(notes) > maxNotesLen {
		notes = notes[:maxNotesLen]
	}

	var inst releaseAsset
	var checksumURL string
	for _, a := range rel.Assets {
		lower := strings.ToLower(strings.TrimSpace(a.Name))
		if checksumURL == "" && (lower == "sha256sums.txt" || lower == "checksums.txt" || strings.HasSuffix(lower, ".sha256")) {
			if strings.HasPrefix(a.BrowserDownloadURL, u.downloadBase) {
				checksumURL = a.BrowserDownloadURL
			}
		}
		if inst.Name == "" && isWindowsInstallerAsset(lower) {
			if strings.HasPrefix(a.BrowserDownloadURL, u.downloadBase) {
				inst = a
			}
		}
	}

	var sha string
	if strings.HasPrefix(strings.ToLower(inst.Digest), "sha256:") {
		cand := strings.ToLower(strings.TrimSpace(inst.Digest[7:]))
		if sha256Re.MatchString(cand) {
			sha = cand
		}
	}

	u.mu.Lock()
	if etag != "" {
		u.etag = etag
	}
	u.latest = latest
	u.notes = notes
	u.releaseURL = strings.TrimSpace(rel.HTMLURL)
	u.installerName = inst.Name
	u.installerURL = inst.BrowserDownloadURL
	u.installerSHA256 = sha
	u.checksumURL = checksumURL
	u.lastErr = ""
	u.checkedAt = time.Now().UnixMilli()
	u.mu.Unlock()
	return nil
}

func isWindowsInstallerAsset(lowerName string) bool {
	if !strings.HasSuffix(lowerName, ".exe") {
		return false
	}
	if strings.Contains(lowerName, "arm64") && runtime.GOARCH == "amd64" {
		return false
	}
	if strings.Contains(lowerName, "amd64") && runtime.GOARCH == "arm64" {
		return false
	}
	return strings.Contains(lowerName, "installer") || strings.Contains(lowerName, "setup")
}

func (u *Updater) setStep(step string) {
	u.mu.Lock()
	u.step = step
	u.mu.Unlock()
}

// Apply downloads the Windows NSIS installer, verifies SHA-256, and starts silent installation.
func (u *Updater) Apply(ctx context.Context) (ApplyResult, error) {
	if !u.applyMu.TryLock() {
		return ApplyResult{}, fmt.Errorf("já há uma atualização em andamento")
	}
	defer func() {
		u.setStep("")
		u.applyMu.Unlock()
	}()

	u.mu.Lock()
	u.doneMsg = ""
	avail := u.isAvailableLocked()
	canApply, reason := u.applyCapabilityLocked()
	latest := u.latest
	instName := u.installerName
	instURL := u.installerURL
	expectedSHA := u.installerSHA256
	checksumURL := u.checksumURL
	downloadBase := u.downloadBase
	ua := "PokeMngr/" + u.current
	u.mu.Unlock()

	if !canApply {
		return ApplyResult{}, fmt.Errorf("%s", reason)
	}
	if !avail {
		return ApplyResult{}, fmt.Errorf("não há versão nova disponível — clique em Verificar atualização")
	}
	if !strings.HasPrefix(instURL, downloadBase) {
		return ApplyResult{}, fmt.Errorf("endereço do instalador fora do repositório oficial")
	}

	// Resolve expected SHA-256 from SHA256SUMS.txt if GitHub digest was absent
	if expectedSHA == "" && checksumURL != "" && strings.HasPrefix(checksumURL, downloadBase) {
		u.setStep("Verificando assinatura SHA-256…")
		if resolved, err := u.fetchChecksumFor(ctx, checksumURL, instName, ua); err == nil && resolved != "" {
			expectedSHA = resolved
		}
	}
	if expectedSHA == "" {
		return ApplyResult{}, fmt.Errorf("não foi possível validar o SHA-256 desta Release; baixe manualmente pela página da Release")
	}

	u.setStep("Baixando instalador…")
	folder, err := os.MkdirTemp("", "pokemngr-update-*")
	if err != nil {
		return ApplyResult{}, fmt.Errorf("criar pasta temporária: %w", err)
	}
	safeName := filepath.Base(instName)
	if safeName == "" || safeName == "." || !strings.HasSuffix(strings.ToLower(safeName), ".exe") {
		safeName = "poke-mngr-installer.exe"
	}
	targetPath := filepath.Join(folder, safeName)

	gotSHA, err := u.downloadAndHash(ctx, instURL, targetPath, ua)
	if err != nil {
		_ = os.RemoveAll(folder)
		return ApplyResult{}, err
	}

	if !strings.EqualFold(gotSHA, expectedSHA) {
		_ = os.RemoveAll(folder)
		return ApplyResult{}, fmt.Errorf("SHA-256 do arquivo baixado não confere com a Release — instalação abortada")
	}

	u.setStep("Iniciando instalador silencioso…")
	if err := launchSilentInstaller(targetPath); err != nil {
		_ = os.RemoveAll(folder)
		return ApplyResult{}, fmt.Errorf("falha ao iniciar instalador: %w", err)
	}

	msg := fmt.Sprintf("Instalando a versão %s. O PokeMngr vai fechar e reabrir automaticamente.", latest)
	u.mu.Lock()
	u.doneMsg = msg
	u.mu.Unlock()

	go func() {
		time.Sleep(1500 * time.Millisecond)
		if u.onBeforeExit != nil {
			u.onBeforeExit()
		}
		os.Exit(0)
	}()

	return ApplyResult{
		OK:         true,
		Restarting: true,
		Message:    msg,
	}, nil
}

func (u *Updater) fetchChecksumFor(ctx context.Context, url, assetName, ua string) (string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", ua)
	resp, err := u.httpCli.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return parseSHA256Sums(io.LimitReader(resp.Body, 256*1024), assetName), nil
}

func parseSHA256Sums(r io.Reader, assetName string) string {
	scanner := bufio.NewScanner(r)
	lowerAsset := strings.ToLower(strings.TrimSpace(assetName))
	var singleHash string
	lines := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) == 0 || !sha256Re.MatchString(fields[0]) {
			continue
		}
		hash := strings.ToLower(fields[0])
		lines++
		if len(fields) == 1 {
			singleHash = hash
			continue
		}
		name := strings.TrimPrefix(fields[1], "*")
		name = strings.ToLower(filepath.Base(name))
		if name == lowerAsset {
			return hash
		}
	}
	if lines == 1 && singleHash != "" {
		return singleHash
	}
	return ""
}

func (u *Updater) downloadAndHash(ctx context.Context, url, destPath, ua string) (string, error) {
	dlCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	dlCli := &http.Client{Transport: u.httpCli.Transport}
	req, err := http.NewRequestWithContext(dlCtx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", ua)
	resp, err := dlCli.Do(req)
	if err != nil {
		return "", fmt.Errorf("erro ao baixar instalador: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download retornou HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	hasher := sha256.New()
	n, copyErr := io.Copy(io.MultiWriter(out, hasher), io.LimitReader(resp.Body, maxInstallerBytes+1))
	closeErr := out.Close()
	if copyErr != nil {
		return "", fmt.Errorf("erro durante o download: %w", copyErr)
	}
	if closeErr != nil {
		return "", closeErr
	}
	if n > maxInstallerBytes {
		return "", fmt.Errorf("instalador excede limite máximo de 250 MB")
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}
