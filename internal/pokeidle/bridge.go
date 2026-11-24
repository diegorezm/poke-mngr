package pokeidle

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"poke-mngr/internal/config"
)

// BridgeHub serves three local-only responsibilities on 127.0.0.1:<ephemeral>:
//  1. Caminho 1 WS Bridge: /bridge/{accountId} multiplexes the embedded pokeidle.io/app WebView
//     onto the Go backend's single upstream WebSocket connection (zero 4001 disconnects, full proxy support).
//  2. Same-origin reverse proxy for https://pokeidle.io (/app and all game assets/scripts),
//     stripping CSP / X-Frame-Options and injecting the per-account WS Bridge + virtual localStorage
//     script directly into <head> so WebView2 / iframes connect seamlessly to 127.0.0.1.
//  3. Local sprite/asset proxy for the React UI: /api/sprite-atlas and /api/sprite/{looktype}.
type BridgeHub struct {
	mu       sync.RWMutex
	listener net.Listener
	server   *http.Server
	port     int
	secret   string

	clients map[int]map[*bridgeClient]struct{}
	manager *AccountManager
	sprites *SpriteProxy
	proxy   *httputil.ReverseProxy
	httpCli *http.Client
}

type bridgeClient struct {
	accountID int
	conn      *websocket.Conn
	sendCh    chan []byte
	done      chan struct{}
	once      sync.Once
}

func (c *bridgeClient) close() {
	c.once.Do(func() {
		close(c.done)
		_ = c.conn.Close(websocket.StatusNormalClosure, "closed")
	})
}

func NewBridgeHub(mgr *AccountManager, sprites *SpriteProxy, secret string) *BridgeHub {
	target, _ := url.Parse(config.SiteOrigin)
	rp := httputil.NewSingleHostReverseProxy(target)
	origDirector := rp.Director
	rp.Director = func(req *http.Request) {
		origDirector(req)
		req.Host = target.Host
		req.Header.Set("Origin", config.SiteOrigin)
		req.Header.Set("Referer", config.GameAppURL)
	}
	rp.ModifyResponse = func(resp *http.Response) error {
		resp.Header.Del("Content-Security-Policy")
		resp.Header.Del("Content-Security-Policy-Report-Only")
		resp.Header.Del("X-Frame-Options")
		resp.Header.Del("Strict-Transport-Security")
		// Strip Secure/SameSite=None from Set-Cookie so http://127.0.0.1 accepts them
		if cookies := resp.Header.Values("Set-Cookie"); len(cookies) > 0 {
			resp.Header.Del("Set-Cookie")
			for _, c := range cookies {
				c = strings.ReplaceAll(c, "; Secure", "")
				c = strings.ReplaceAll(c, "; secure", "")
				c = strings.ReplaceAll(c, "; SameSite=None", "; SameSite=Lax")
				resp.Header.Add("Set-Cookie", c)
			}
		}
		return nil
	}

	return &BridgeHub{
		clients: map[int]map[*bridgeClient]struct{}{},
		manager: mgr,
		sprites: sprites,
		secret:  secret,
		proxy:   rp,
		httpCli: &http.Client{Timeout: 20 * time.Second},
	}
}

func (b *BridgeHub) Start() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, fmt.Errorf("bridge listen: %w", err)
	}
	b.listener = ln
	b.port = ln.Addr().(*net.TCPAddr).Port

	mux := http.NewServeMux()
	mux.HandleFunc("/bridge/", b.handleBridgeWS)
	mux.HandleFunc("/api/sprite-atlas", b.handleSpriteAtlas)
	mux.HandleFunc("/api/sprite/", b.handleSpriteOutfit)
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/app", b.handleProxiedGameApp)
	mux.HandleFunc("/app/", b.handleProxiedGameApp)
	mux.HandleFunc("/", b.handleReverseProxy)

	b.server = &http.Server{
		Handler:           corsLocalMiddleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := b.server.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("[bridge] server error: %v", err)
		}
	}()
	return b.port, nil
}

func (b *BridgeHub) Port() int {
	return b.port
}

func (b *BridgeHub) Secret() string {
	return b.secret
}

func (b *BridgeHub) GameURL(accountID int) string {
	return fmt.Sprintf("http://127.0.0.1:%d/app?__acc=%d&__s=%s", b.port, accountID, b.secret)
}

func (b *BridgeHub) Stop(ctx context.Context) {
	b.mu.Lock()
	for _, set := range b.clients {
		for c := range set {
			c.close()
		}
	}
	b.clients = map[int]map[*bridgeClient]struct{}{}
	b.mu.Unlock()
	if b.server != nil {
		_ = b.server.Shutdown(ctx)
	}
}

func (b *BridgeHub) HasAttached(accountID int) bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.clients[accountID]) > 0
}

// BroadcastServerFrame forwards an upstream PokéIdle frame to all attached WebView clients of accountID.
func (b *BridgeHub) BroadcastServerFrame(accountID int, raw []byte) {
	b.mu.RLock()
	set := b.clients[accountID]
	if len(set) == 0 {
		b.mu.RUnlock()
		return
	}
	targets := make([]*bridgeClient, 0, len(set))
	for c := range set {
		targets = append(targets, c)
	}
	b.mu.RUnlock()

	for _, c := range targets {
		select {
		case c.sendCh <- raw:
		default:
		}
	}
}

func (b *BridgeHub) handleProxiedGameApp(w http.ResponseWriter, r *http.Request) {
	if b.secret != "" && r.URL.Query().Get("__s") != b.secret {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	accID, err := strconv.Atoi(r.URL.Query().Get("__acc"))
	if err != nil || accID <= 0 {
		http.Error(w, "missing __acc", http.StatusBadRequest)
		return
	}
	conn := b.manager.GetConnection(accID)
	if conn == nil {
		http.Error(w, "account not found", http.StatusNotFound)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, config.GameAppURL, nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	// Request uncompressed HTML so we can inject the bootstrap script cleanly.
	req.Header.Set("Accept-Encoding", "identity")
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	req.Header.Set("User-Agent", r.Header.Get("User-Agent"))

	resp, err := b.httpCli.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("erro ao carregar pokeidle.io/app: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}

	acc := conn.Account()
	gs := b.manager.Settings()
	initJS := buildBridgeBootstrapJS(acc.ID, acc.Nick, acc.Token, acc.DeviceID, b.port, b.secret, gs.DeckReduceMotion, gs.DeckUltra)
	injectTag := "<head>\n<script>" + initJS + "</script>\n"

	html := string(bodyBytes)
	if strings.Contains(html, "<head>") {
		html = strings.Replace(html, "<head>", injectTag, 1)
	} else {
		html = "<script>" + initJS + "</script>\n" + html
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.WriteString(w, html)
}

func (b *BridgeHub) handleReverseProxy(w http.ResponseWriter, r *http.Request) {
	b.proxy.ServeHTTP(w, r)
}

func (b *BridgeHub) handleBridgeWS(w http.ResponseWriter, r *http.Request) {
	if b.secret != "" && r.URL.Query().Get("s") != b.secret {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	idStr := strings.TrimPrefix(r.URL.Path, "/bridge/")
	idStr = strings.Trim(idStr, "/")
	accID, err := strconv.Atoi(idStr)
	if err != nil || accID <= 0 {
		http.Error(w, "invalid account id", http.StatusBadRequest)
		return
	}
	conn := b.manager.GetConnection(accID)
	if conn == nil {
		http.Error(w, "account not found", http.StatusNotFound)
		return
	}

	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Printf("[bridge] accept acc=%d failed: %v", accID, err)
		return
	}
	ws.SetReadLimit(16 << 20)

	client := &bridgeClient{
		accountID: accID,
		conn:      ws,
		sendCh:    make(chan []byte, 256),
		done:      make(chan struct{}),
	}

	b.register(accID, client)
	defer b.unregister(accID, client)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				return
			case <-client.done:
				return
			case msg := <-client.sendCh:
				wctx, wcancel := context.WithTimeout(ctx, 10*time.Second)
				err := ws.Write(wctx, websocket.MessageText, msg)
				wcancel()
				if err != nil {
					return
				}
			}
		}
	}()

	for {
		_, data, err := ws.Read(ctx)
		if err != nil {
			return
		}
		var frame map[string]any
		if err := json.Unmarshal(data, &frame); err != nil {
			continue
		}
		t := asString(frame["t"])
		switch t {
		case "ping":
			select {
			case client.sendCh <- []byte(`{"t":"pong"}`):
			case <-ctx.Done():
				return
			}
			continue
		case "hello":
			// Replay cached welcome (with up-to-date merged estado) + cached campo.init + latest campo!
			for _, replay := range conn.BuildBridgeReplayFrames() {
				select {
				case client.sendCh <- replay:
				case <-ctx.Done():
					return
				}
			}
			continue
		}
		if err := conn.ForwardFromBridge(ctx, t, data); err != nil {
			log.Printf("[bridge] acc=%d forward t=%s err=%v", accID, t, err)
		}
	}
}

func (b *BridgeHub) register(accID int, c *bridgeClient) {
	b.mu.Lock()
	if b.clients[accID] == nil {
		b.clients[accID] = map[*bridgeClient]struct{}{}
	}
	b.clients[accID][c] = struct{}{}
	b.mu.Unlock()
	b.manager.notifyTelemetryDirty()
}

func (b *BridgeHub) unregister(accID int, c *bridgeClient) {
	c.close()
	b.mu.Lock()
	if set := b.clients[accID]; set != nil {
		delete(set, c)
		if len(set) == 0 {
			delete(b.clients, accID)
		}
	}
	b.mu.Unlock()
	b.manager.notifyTelemetryDirty()
}

func (b *BridgeHub) handleSpriteAtlas(w http.ResponseWriter, r *http.Request) {
	raw, err := b.sprites.GetAtlas(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(raw)
}

func (b *BridgeHub) handleSpriteOutfit(w http.ResponseWriter, r *http.Request) {
	idStr := strings.TrimPrefix(r.URL.Path, "/api/sprite/")
	idStr = strings.Trim(idStr, "/")
	looktype, err := strconv.Atoi(idStr)
	if err != nil || looktype <= 0 || looktype >= 10_000_000 {
		http.Error(w, "invalid looktype", http.StatusBadRequest)
		return
	}
	data, err := b.sprites.GetOutfit(r.Context(), looktype)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	if data == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=21600")
	_ = json.NewEncoder(w).Encode(data)
}

func corsLocalMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func buildBridgeBootstrapJS(accID int, nick, token, deviceID string, bridgePort int, bridgeSecret string, reduceMotion, ultra bool) string {
	sessBytes, _ := json.Marshal(map[string]any{
		"nick":  nick,
		"token": token,
	})
	devBytes, _ := json.Marshal(deviceID)
	bridgeURL := fmt.Sprintf("ws://127.0.0.1:%d/bridge/%d?s=%s", bridgePort, accID, bridgeSecret)
	bridgeURLBytes, _ := json.Marshal(bridgeURL)
	ultraVal := "0"
	if ultra {
		ultraVal = "1"
	}

	return fmt.Sprintf(`(function() {
  if (window.__pokeMngrBridgeInstalled) return;
  window.__pokeMngrBridgeInstalled = true;

  // 1. Virtualize per-window session keys so multiple accounts never overwrite each other's localStorage
  try {
    var mem = {
      'sessao': %q,
      'id-dispositivo': %s,
      'cfg-ultra': %q
    };
    var origGet = Storage.prototype.getItem;
    var origSet = Storage.prototype.setItem;
    var origRem = Storage.prototype.removeItem;
    Storage.prototype.getItem = function(k) {
      if (this === window.localStorage && Object.prototype.hasOwnProperty.call(mem, k)) {
        return mem[k];
      }
      return origGet.call(this, k);
    };
    Storage.prototype.setItem = function(k, v) {
      if (this === window.localStorage && Object.prototype.hasOwnProperty.call(mem, k)) {
        mem[k] = String(v);
        return;
      }
      return origSet.call(this, k, v);
    };
    Storage.prototype.removeItem = function(k) {
      if (this === window.localStorage && Object.prototype.hasOwnProperty.call(mem, k)) {
        return;
      }
      return origRem.call(this, k);
    };
  } catch (e) {}

  // 2. Proxy window.WebSocket -> Go Caminho 1 Bridge (same-origin 127.0.0.1, zero CSP/Mixed-Content issues)
  var NativeWS = window.WebSocket;
  var BRIDGE_URL = %s;
  window.WebSocket = new Proxy(NativeWS, {
    construct: function(target, args, newTarget) {
      try {
        var rawUrl = String(args[0] || '');
        if (rawUrl.indexOf(location.host) !== -1 || rawUrl.indexOf('pokeidle.io') !== -1) {
          var nextArgs = args.slice();
          nextArgs[0] = BRIDGE_URL;
          return Reflect.construct(target, nextArgs, newTarget);
        }
      } catch (e) {}
      return Reflect.construct(target, args, newTarget);
    }
  });

  // 3. Optional Reduce Motion (pokeidleDeck technique)
  var REDUCE = %t;
  if (REDUCE) {
    try {
      var origMM = window.matchMedia.bind(window);
      window.matchMedia = function(q) {
        if (typeof q === 'string' && q.indexOf('prefers-reduced-motion') !== -1) {
          var m = q.indexOf('reduce') !== -1;
          return {
            matches: m, media: q, onchange: null,
            addListener: function(){}, removeListener: function(){},
            addEventListener: function(){}, removeEventListener: function(){},
            dispatchEvent: function(){ return false; }
          };
        }
        return origMM(q);
      };
    } catch (e) {}
  }
})();`, string(sessBytes), string(devBytes), ultraVal, string(bridgeURLBytes), reduceMotion)
}
