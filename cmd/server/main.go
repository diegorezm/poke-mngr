package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"poke-mngr/internal/config"
	"poke-mngr/internal/pokeidle"
	"poke-mngr/internal/server"
	"poke-mngr/internal/store"
)

// Headless VPS server entrypoint (pure Go, zero GUI/Wails dependency, Linux/Windows/Docker ready).
func main() {
	addr := flag.String("addr", envOr("POKE_MNGR_ADDR", "127.0.0.1:8080"), "HTTP listen address")
	token := flag.String("token", os.Getenv("POKE_MNGR_TOKEN"), "Bearer/query API token (recommended when exposed)")
	flag.Parse()

	st, err := store.Open(config.DBPath())
	if err != nil {
		log.Fatalf("erro ao abrir banco SQLite: %v", err)
	}
	defer st.Close()

	mgr := pokeidle.NewAccountManager(st)
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := mgr.Start(ctx); err != nil {
		log.Fatalf("erro ao iniciar AccountManager: %v", err)
	}
	defer mgr.Stop()

	srv := server.New(*addr, *token, mgr, nil)
	go func() {
		if err := srv.Start(); err != nil {
			log.Printf("[vps-server] encerrado: %v", err)
		}
	}()

	<-ctx.Done()
	shCtx, shCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shCancel()
	_ = srv.Shutdown(shCtx)
}

func envOr(k, fallback string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return fallback
}
