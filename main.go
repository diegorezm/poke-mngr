package main

import (
	"context"
	"embed"
	"fmt"
	"log"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"

	"poke-mngr/internal/config"
	"poke-mngr/internal/pokeidle"
	"poke-mngr/internal/service"
	"poke-mngr/internal/store"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var trayIcon []byte

func init() {
	application.RegisterEvent[pokeidle.TelemetrySnapshot]("telemetry")
	application.RegisterEvent[pokeidle.ChatEvent]("chat")
}

func main() {
	st, err := store.Open(config.DBPath())
	if err != nil {
		log.Fatalf("falha ao abrir banco de dados: %v", err)
	}
	defer st.Close()

	mgr := pokeidle.NewAccountManager(st)
	appSvc := service.NewAppService(mgr)

	var quitting atomic.Bool
	var mainWin *application.WebviewWindow
	var tray *application.SystemTray

	app := application.New(application.Options{
		Name:        "PokeMngr",
		Description: "Gerenciador Desktop multi-conta para PokéIdle",
		Services: []application.Service{
			application.NewService(appSvc),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.pokemngr.desktop.v1",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if mainWin != nil {
					mainWin.Show()
					mainWin.UnMinimise()
					mainWin.Focus()
				}
			},
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		OnShutdown: func() {
			appSvc.CloseAllGameWindows()
			mgr.Stop()
		},
	})
	appSvc.BindApp(app)

	gs := mgr.Settings()
	mainWin = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main",
		Title:            "PokeMngr — PokéIdle Desktop",
		Width:            1280,
		Height:           820,
		MinWidth:         900,
		MinHeight:        600,
		Hidden:           gs.StartMinimized,
		BackgroundColour: application.NewRGB(9, 11, 20),
		URL:              "/",
	})

	// Hide to system tray instead of exiting when user clicks the X button
	mainWin.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if quitting.Load() {
			return
		}
		if mgr.Settings().MinimizeToTrayOnClose {
			e.Cancel()
			mainWin.Hide()
		}
	})

	// System Tray setup
	tray = app.SystemTray.New()
	tray.SetIcon(trayIcon)
	tray.SetTooltip("PokeMngr — Iniciando...")

	showMain := func() {
		if mainWin == nil {
			return
		}
		mainWin.Show()
		mainWin.UnMinimise()
		mainWin.Focus()
	}

	trayMenu := app.NewMenu()
	trayMenu.Add("Abrir Painel").OnClick(func(_ *application.Context) {
		showMain()
	})
	trayMenu.Add("Abrir Telas do Jogo (Deck)").OnClick(func(_ *application.Context) {
		_ = appSvc.OpenAllGameWindows()
	})
	trayMenu.Add("Fechar Telas do Jogo (Economizar RAM)").OnClick(func(_ *application.Context) {
		appSvc.CloseAllGameWindows()
	})
	trayMenu.AddSeparator()
	trayMenu.Add("Minimizar para Bandeja").OnClick(func(_ *application.Context) {
		if mainWin != nil {
			mainWin.Hide()
		}
	})
	trayMenu.AddSeparator()
	trayMenu.Add("Sair do PokeMngr").OnClick(func(_ *application.Context) {
		quitting.Store(true)
		app.Quit()
	})
	tray.SetMenu(trayMenu)
	tray.OnClick(func() {
		if mainWin == nil {
			return
		}
		if mainWin.IsVisible() {
			mainWin.Hide()
		} else {
			showMain()
		}
	})
	tray.OnDoubleClick(func() {
		showMain()
	})

	// Wire telemetry events + tray tooltip updates
	mgr.SetTelemetryHandler(func(snap pokeidle.TelemetrySnapshot) {
		app.Event.Emit("telemetry", snap)
		online := 0
		for _, a := range snap.Accounts {
			if a.State == pokeidle.StateOnline {
				online++
			}
		}
		if tray != nil {
			tray.SetTooltip(fmt.Sprintf("PokeMngr — %d/%d contas online", online, len(snap.Accounts)))
		}
	})
	mgr.Chat().SetEventHandler(func(ev pokeidle.ChatEvent) {
		app.Event.Emit("chat", ev)
	})

	if err := mgr.Start(context.Background()); err != nil {
		log.Fatalf("falha ao iniciar motor PokéIdle: %v", err)
	}

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
