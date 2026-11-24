package server

import (
	"context"
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"

	"poke-mngr/internal/config"
	"poke-mngr/internal/pokeidle"
)

// Server exposes the pure-Go AccountManager over HTTP + WebSocket for headless VPS/Linux deployments.
type Server struct {
	addr     string
	token    string
	mgr      *pokeidle.AccountManager
	frontend fs.FS
	httpSrv  *http.Server
}

func New(addr, token string, mgr *pokeidle.AccountManager, frontend fs.FS) *Server {
	return &Server{
		addr:     addr,
		token:    strings.TrimSpace(token),
		mgr:      mgr,
		frontend: frontend,
	}
}

func (s *Server) Start() error {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	mux.HandleFunc("/api/telemetry", s.guard(s.handleTelemetry))
	mux.HandleFunc("/ws/telemetry", s.guard(s.handleTelemetryWS))
	mux.HandleFunc("/api/accounts", s.guard(s.handleAccounts))
	mux.HandleFunc("/api/settings", s.guard(s.handleSettings))

	if s.frontend != nil {
		mux.Handle("/", http.FileServer(http.FS(s.frontend)))
	}

	s.httpSrv = &http.Server{
		Addr:              s.addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}
	log.Printf("[vps-server] escutando em http://%s", s.addr)
	return s.httpSrv.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	if s.httpSrv == nil {
		return nil
	}
	return s.httpSrv.Shutdown(ctx)
}

func (s *Server) guard(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.token != "" {
			auth := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			qtok := r.URL.Query().Get("token")
			if auth != s.token && qtok != s.token {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		next(w, r)
	}
}

func (s *Server) handleTelemetry(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s.mgr.Snapshot())
}

func (s *Server) handleTelemetryWS(w http.ResponseWriter, r *http.Request) {
	ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer ws.Close(websocket.StatusNormalClosure, "bye")

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	ctx := r.Context()
	for {
		b, err := json.Marshal(s.mgr.Snapshot())
		if err != nil {
			return
		}
		if err := ws.Write(ctx, websocket.MessageText, b); err != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Server) handleAccounts(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case http.MethodGet:
		accs, err := s.mgr.ListAccountsRedacted()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(accs)
	case http.MethodPost:
		var req struct {
			Account  config.AccountRecord `json:"account"`
			SkipTest bool                 `json:"skipTest"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		saved, probe, err := s.mgr.AddAccount(req.Account, req.SkipTest)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error(), "probe": probe})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"account": saved, "probe": probe})
	case http.MethodDelete:
		id, _ := strconv.Atoi(r.URL.Query().Get("id"))
		if err := s.mgr.DeleteAccount(id); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	switch r.Method {
	case http.MethodGet:
		_ = json.NewEncoder(w).Encode(s.mgr.Settings())
	case http.MethodPut:
		var gs config.GlobalSettings
		if err := json.NewDecoder(r.Body).Decode(&gs); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := s.mgr.UpdateSettings(gs); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		_ = json.NewEncoder(w).Encode(gs)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}
