import React, { useEffect, useState } from "react";
import {
  LayoutDashboard,
  MonitorPlay,
  Map as MapIcon,
  Backpack,
  Store,
  Swords,
  Ticket,
  Radio,
  MessageSquare,
  Settings,
  Eye,
  EyeOff,
  Moon,
  Sun,
} from "lucide-react";
import { api } from "./lib/api";
import {
  GlobalSettings,
  TelemetrySnapshot,
  fmtBytes,
  fmtCompact,
} from "./lib/types";
import { AccountCard } from "./components/AccountCard";
import { DeckView } from "./components/DeckView";
import { MapaView } from "./components/MapaView";
import { InventoryView } from "./components/InventoryView";
import { MarketView } from "./components/MarketView";
import { PvpView } from "./components/PvpView";
import { PassView } from "./components/PassView";
import { LivesView } from "./components/LivesView";
import { ChatView } from "./components/ChatView";
import { SettingsView } from "./components/SettingsView";
import { UpdateBanner } from "./components/UpdateCard";
import { DsRibbon, DsToast, MiniBall, RibbonTone } from "./components/DsPrimitives";

type TabId =
  | "dashboard"
  | "deck"
  | "mapa"
  | "inventario"
  | "mercado"
  | "pvp"
  | "passe"
  | "lives"
  | "chat"
  | "config";

type DsTheme = "day" | "night";

const NAV_ITEMS: {
  id: TabId;
  label: string;
  icon: typeof LayoutDashboard;
  tone: RibbonTone;
  ribbonTitle: string;
}[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, tone: "red", ribbonTitle: "Contas Ativas · Painel de Treinadores" },
  { id: "deck", label: "Deck Visual", icon: MonitorPlay, tone: "slate", ribbonTitle: "Deck Visual · Bridge ao Vivo" },
  { id: "mapa", label: "Mapa / Hunts", icon: MapIcon, tone: "red", ribbonTitle: "Pokédex · Mapa de Hunts" },
  { id: "inventario", label: "Inventário", icon: Backpack, tone: "slate", ribbonTitle: "PC Box & Mochila · Inventário" },
  { id: "mercado", label: "Mercado & Sniper", icon: Store, tone: "blue", ribbonTitle: "Poké Mart · Mercado & Sniper" },
  { id: "pvp", label: "PvP", icon: Swords, tone: "red", ribbonTitle: "Arena PvP · Liga & Tabuleiro" },
  { id: "passe", label: "Passe", icon: Ticket, tone: "slate", ribbonTitle: "Passe de Batalha · Trilha 30 Dias" },
  { id: "lives", label: "Lives Twitch/Kick", icon: Radio, tone: "purple", ribbonTitle: "Lives Twitch & Kick" },
  { id: "chat", label: "Chat", icon: MessageSquare, tone: "blue", ribbonTitle: "Comunicador · Chat do Jogo" },
  { id: "config", label: "Contas & Config", icon: Settings, tone: "slate", ribbonTitle: "Sistema · Contas & Configurações" },
];

const DEFAULT_SETTINGS: GlobalSettings = {
  wsUrl: "wss://pokeidle.io",
  discordWebhookUrl: "",
  dailyReportHour: 0,
  reportTz: "America/Sao_Paulo",
  externalLoginWaitMin: 5,
  downAlertDelaySec: 120,
  minimizeToTrayOnClose: true,
  startMinimized: false,
  cardStyle: "padrao",
  language: "pt",
  sniperEnabled: false,
  autoSellEnabled: false,
  autoSellDryRun: false,
  marketSellAlert: false,
  marketSellAlertPct: 30,
  deckLayout: "grid",
  deckZoom: 1.0,
  deckUltra: false,
  deckReduceMotion: true,
  deckHuntExt: false,
};

function readInitialTheme(): DsTheme {
  try {
    const saved = localStorage.getItem("pokemngr.dsTheme");
    return saved === "night" ? "night" : "day";
  } catch {
    return "day";
  }
}

function saveTheme(theme: DsTheme) {
  try {
    localStorage.setItem("pokemngr.dsTheme", theme);
  } catch {
    // Ignore storage unavailability
  }
}

class TabErrorBoundary extends React.Component<
  { tabKey: string; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prevProps: { tabKey: string }) {
    if (prevProps.tabKey !== this.props.tabKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="px-box p-6 max-w-xl mx-auto mt-8 space-y-3 text-xs">
          <div className="font-bold text-sm text-[var(--ink-accent-rose)]">
            Erro ao renderizar esta aba
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] px-inset p-3 overflow-auto text-[var(--ink)]">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="ds-btn ds-btn-blue"
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [theme, setTheme] = useState<DsTheme>(readInitialTheme);
  const [snap, setSnap] = useState<TelemetrySnapshot>(() => ({
    serverTimeMs: Date.now(),
    bridgePort: 0,
    accounts: [],
  }));
  const [settings, setSettings] = useState<GlobalSettings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

  useEffect(() => {
    if (theme === "night") {
      document.documentElement.setAttribute("data-theme", "night");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
    saveTheme(theme);
  }, [theme]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((cur) => (cur === msg ? null : cur));
    }, 3500);
  };

  useEffect(() => {
    api.getSnapshot().then(setSnap).catch(() => {});
    api.getSettings().then(setSettings).catch(() => {});
    const off = api.onTelemetry((next) => setSnap(next));
    return () => {
      if (typeof off === "function") off();
    };
  }, []);

  const onlineCount = snap.accounts.filter((a) => a.state === "ONLINE").length;
  const totalXpH = snap.accounts.reduce((s, a) => s + (a.hunt?.xpPerHour || 0), 0);
  const totalGoldH = snap.accounts.reduce((s, a) => s + (a.hunt?.goldPerHour || 0), 0);
  const totalGold = snap.accounts.reduce((s, a) => s + (a.gold || 0), 0);
  const totalOrbs = snap.accounts.reduce((s, a) => s + (a.orbs || 0), 0);
  const openBridges = snap.accounts.filter((a) => a.bridgeAttached).length;

  const activeNav = NAV_ITEMS.find((n) => n.id === tab) || NAV_ITEMS[0];

  const handleDropOn = async (targetId: number) => {
    if (dragId === null || dragId === targetId) return;
    const ids = snap.accounts.map((a) => a.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(to, 0, dragId);
    setDragId(null);
    await api.reorderAccounts(ids).catch(() => {});
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--shell-bg)] text-[var(--ink)]">
      {/* Pokédex Red Edition Hardware Sidebar */}
      <aside className="w-60 shrink-0 ds-sidebar flex flex-col">
        {/* Iconic Pokédex Crimson Bezel + Blue Camera Lens + RGB LEDs */}
        <div className="bg-gradient-to-b from-[#e04338] to-[#c72d23] border-b-[1.5px] border-[#1b1f26] px-3.5 py-3 flex items-center gap-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]">
          <div className="pokedex-lens" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold text-[15px] text-white tracking-tight leading-none">
                PokeMngr
              </span>
              <span className="inline-flex items-center gap-1" aria-hidden="true">
                <span className="w-2 h-2 rounded-full bg-[#ef4444] border border-[#1b1f26]" />
                <span className="w-2 h-2 rounded-full bg-[#facc15] border border-[#1b1f26]" />
                <span className="w-2 h-2 rounded-full bg-[#4ade80] border border-[#1b1f26]" />
              </span>
            </div>
            <div className="font-mono-num text-[10px] font-semibold text-red-100/90 mt-0.5 tracking-wider">
              DEX-OS · BRIDGE WS
            </div>
          </div>
        </div>

        <div className="text-[10px] font-bold uppercase tracking-widest text-[var(--ink-subtle)] px-3.5 pt-3.5 pb-1.5">
          Módulos
        </div>

        <nav className="flex-1 px-2.5 pb-2.5 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`group w-full flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-semibold transition-all duration-120 cursor-pointer ${
                  active
                    ? "bg-[var(--dex-red)] text-white border-[1.5px] border-[#1b1f26] shadow-[0_2px_0_#1b1f26]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--panel-bg)] border-[1.5px] border-transparent hover:border-[var(--border-mid)]"
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  {active ? (
                    <MiniBall className="group-hover-wobble" />
                  ) : (
                    <Icon className="w-4 h-4 shrink-0 opacity-80" />
                  )}
                  <span className="truncate">{item.label}</span>
                </span>
                {active && (
                  <span className="w-1.5 h-1.5 rounded-full bg-white shrink-0" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom Hardware Telemetry Screen */}
        <div className="p-2.5 border-t-[1.5px] border-[var(--border-mid)]">
          <div className="rounded-lg bg-[#1b1f26] border border-[#2d3442] px-3 py-2.5 text-[11px] text-[#cbd5e1] space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    snap.bridgePort
                      ? "bg-[#22c55e] animate-ds-led"
                      : "bg-slate-500"
                  }`}
                />
                Bridge local
              </span>
              <span className="font-mono-num text-[11px] font-bold text-[#4ade80]">
                {snap.bridgePort ? `:${snap.bridgePort}` : "OFF"}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Telas Deck</span>
              <span className="font-mono-num text-[11px] font-bold text-[#38bdf8]">
                {openBridges}/{snap.accounts.length}
              </span>
            </div>
            {snap.memory && snap.memory.totalBytes > 0 && (
              <div
                className="flex justify-between items-center"
                title={`App: ${fmtBytes(snap.memory.appBytes)} · WebView2: ${fmtBytes(snap.memory.webViewBytes)} (${snap.memory.processCount} processos)`}
              >
                <span className="text-slate-400">Memória RAM</span>
                <span className="font-mono-num text-[11px] font-bold text-[#fbbf24]">
                  {fmtBytes(snap.memory.totalBytes)}
                </span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Hardware Telemetry Bar */}
        <header className="min-h-14 shrink-0 bg-[var(--panel-bg)] border-b-[1.5px] border-[var(--border-dark)] px-5 py-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="px-inset px-2.5 py-1 inline-flex items-center gap-1.5 text-xs">
              <span className="text-[var(--ink-muted)] font-semibold">Online</span>
              <span className="font-mono-num font-bold text-[var(--ink-accent-green)]">
                {onlineCount}/{snap.accounts.length}
              </span>
            </div>
            <div className="px-inset px-2.5 py-1 inline-flex items-center gap-1.5 text-xs">
              <span className="text-[var(--ink-muted)] font-semibold">XP/h</span>
              <span className="font-mono-num font-bold text-[var(--ink-accent-sky)]">
                {fmtCompact(totalXpH)}
              </span>
            </div>
            <div className="px-inset px-2.5 py-1 inline-flex items-center gap-1.5 text-xs">
              <span className="text-[var(--ink-muted)] font-semibold">Ouro/h</span>
              <span className="font-mono-num font-bold text-[var(--ink-accent-amber)]">
                {fmtCompact(totalGoldH)}
              </span>
            </div>
            <div className="px-inset px-2.5 py-1 inline-flex items-center gap-1.5 text-xs">
              <span className="text-[var(--ink-muted)] font-semibold">Total</span>
              <span className="font-mono-num font-bold text-[var(--ink)]">
                {fmtCompact(totalGold)}
              </span>
            </div>
            <div className="px-inset px-2.5 py-1 inline-flex items-center gap-1.5 text-xs">
              <span className="text-[var(--ink-muted)] font-semibold">Gemas</span>
              <span className="font-mono-num font-bold text-[var(--ink-accent-fuchsia)]">
                {fmtCompact(totalOrbs)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setTheme((t) => (t === "day" ? "night" : "day"))}
              className="ds-btn ds-btn-slate ds-btn-sm"
              title="Alternar entre Pokédex Red (Claro) e Smoked Carbon (Escuro)"
            >
              {theme === "day" ? (
                <>
                  <Moon className="w-3.5 h-3.5" /> Carbon Dark
                </>
              ) : (
                <>
                  <Sun className="w-3.5 h-3.5" /> Pokédex Claro
                </>
              )}
            </button>

            {openBridges > 0 ? (
              <button
                onClick={() => api.closeAllGameWindows()}
                className="ds-btn ds-btn-red ds-btn-sm"
              >
                <EyeOff className="w-3.5 h-3.5" /> Fechar Jogos ({openBridges})
              </button>
            ) : (
              <button
                disabled={snap.accounts.length === 0}
                onClick={() => api.openAllGameWindows()}
                className="ds-btn ds-btn-blue ds-btn-sm"
              >
                <Eye className="w-3.5 h-3.5" /> Abrir Deck
              </button>
            )}
          </div>
        </header>

        {/* Update Available Banner */}
        <UpdateBanner />

        {/* Workspace Canvas */}
        <main
          className={
            tab === "deck"
              ? "flex-1 overflow-hidden p-0 ds-themed-view"
              : "flex-1 overflow-y-auto p-5"
          }
        >
          <TabErrorBoundary tabKey={tab}>
            <div key={tab} className={tab === "deck" ? "h-full animate-ds-tab" : "space-y-4 animate-ds-tab"}>
              {tab !== "deck" && tab !== "mapa" && (
                <DsRibbon
                  title={activeNav.ribbonTitle}
                  tone={activeNav.tone}
                  right={
                    tab === "dashboard" && snap.accounts.length > 0 ? (
                      <span className="text-xs font-medium text-white/90">
                        Arraste os cartões para reordenar · Clique em Poção ou Pokébola para equipar
                      </span>
                    ) : undefined
                  }
                />
              )}

              {tab === "dashboard" && (
                <div className="space-y-4">
                  {snap.accounts.length === 0 ? (
                    <div className="px-box p-10 text-center space-y-4 max-w-xl mx-auto mt-8">
                      <div className="mx-auto w-11 h-11 rounded-full border-2 border-[#1b1f26] bg-gradient-to-b from-[#e04338] via-[#1b1f26] to-white animate-ds-idle" />
                      <div className="text-lg font-bold text-[var(--ink)]">
                        Bem-vindo ao PokeMngr
                      </div>
                      <p className="text-sm text-[var(--ink-muted)]">
                        Adicione até 4 contas do <b>pokeidle.io</b> para farmar leve na bandeja do Windows e abrir a visualização ao vivo do personagem quando quiser sem derrubar a sessão (Bridge WS).
                      </p>
                      <button
                        onClick={() => setTab("config")}
                        className="ds-btn ds-btn-red"
                      >
                        Adicionar Primeira Conta
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                      {snap.accounts.map((acc, index) => (
                        <AccountCard
                          key={acc.id}
                          acc={acc}
                          cardIndex={index}
                          bridgePort={snap.bridgePort}
                          serverTimeMs={snap.serverTimeMs}
                          cardStyle={settings.cardStyle}
                          onToast={showToast}
                          onDragStart={() => setDragId(acc.id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleDropOn(acc.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === "deck" && (
                <DeckView
                  accounts={snap.accounts}
                  settings={settings}
                  onSettingsChange={setSettings}
                  onToast={showToast}
                />
              )}

              {tab === "mapa" && (
                <MapaView
                  accounts={snap.accounts}
                  bridgePort={snap.bridgePort}
                  onToast={showToast}
                />
              )}

              {tab === "inventario" && (
                <div className="ds-themed-view">
                  <InventoryView
                    accounts={snap.accounts}
                    bridgePort={snap.bridgePort}
                    onToast={showToast}
                  />
                </div>
              )}

              {tab === "passe" && (
                <div className="ds-themed-view">
                  <PassView
                    accounts={snap.accounts}
                    serverTimeMs={snap.serverTimeMs}
                    onToast={showToast}
                  />
                </div>
              )}

              {tab === "chat" && (
                <div className="ds-themed-view">
                  <ChatView
                    accounts={snap.accounts}
                    bridgePort={snap.bridgePort}
                    onToast={showToast}
                  />
                </div>
              )}

              {tab === "mercado" && (
                <div className="ds-themed-view">
                  <MarketView
                    accounts={snap.accounts}
                    bridgePort={snap.bridgePort}
                    settings={settings}
                    onSettingsChange={setSettings}
                    onToast={showToast}
                  />
                </div>
              )}

              {tab === "pvp" && (
                <div className="ds-themed-view">
                  <PvpView bridgePort={snap.bridgePort} onToast={showToast} />
                </div>
              )}

              {tab === "lives" && (
                <div className="ds-themed-view">
                  <LivesView onToast={showToast} />
                </div>
              )}

              {tab === "config" && (
                <div className="ds-themed-view">
                  <SettingsView
                    settings={settings}
                    serverTimeMs={snap.serverTimeMs}
                    onSettingsChange={setSettings}
                    onToast={showToast}
                  />
                </div>
              )}
            </div>
          </TabErrorBoundary>
        </main>
      </div>

      {/* Modern Pokédex Notification Toast */}
      <DsToast message={toast} />
    </div>
  );
}

export default App;
