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
  Coins,
  Gem,
  Zap,
  Users,
  Eye,
  EyeOff,
} from "lucide-react";
import { api } from "./lib/api";
import {
  GlobalSettings,
  TelemetrySnapshot,
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

const NAV_ITEMS: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "deck", label: "Deck Visual", icon: MonitorPlay },
  { id: "mapa", label: "Mapa / Hunts", icon: MapIcon },
  { id: "inventario", label: "Inventário", icon: Backpack },
  { id: "mercado", label: "Mercado & Sniper", icon: Store },
  { id: "pvp", label: "PvP", icon: Swords },
  { id: "passe", label: "Passe", icon: Ticket },
  { id: "lives", label: "Lives Twitch/Kick", icon: Radio },
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "config", label: "Contas & Config", icon: Settings },
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
  deckLayout: "grid",
  deckZoom: 1.0,
  deckUltra: false,
  deckReduceMotion: true,
  deckHuntExt: false,
};

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
        <div className="rounded-2xl bg-rose-500/10 border border-rose-500/30 p-6 max-w-xl mx-auto mt-8 space-y-2 text-xs text-rose-200">
          <div className="font-semibold text-sm text-rose-300">
            Erro ao renderizar esta aba
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[11px] bg-black/30 p-3 rounded-lg overflow-auto">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white"
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
  const [snap, setSnap] = useState<TelemetrySnapshot>({
    serverTimeMs: Date.now(),
    bridgePort: 0,
    accounts: [],
  });
  const [settings, setSettings] = useState<GlobalSettings>(DEFAULT_SETTINGS);
  const [toast, setToast] = useState<string | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);

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
    <div className="flex h-screen w-screen overflow-hidden bg-[#090b14] text-slate-100">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-[#0d101d] border-r border-slate-800/80 flex flex-col">
        <div className="px-4 py-4 border-b border-slate-800/80 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 flex items-center justify-center font-black text-slate-950 shadow">
            P
          </div>
          <div>
            <div className="font-bold text-sm tracking-tight text-white">PokeMngr</div>
            <div className="text-[10px] text-slate-400">Desktop Tray · Bridge WS</div>
          </div>
        </div>

        <nav className="flex-1 p-2.5 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition ${
                  active
                    ? "bg-amber-500/15 text-amber-300 border border-amber-500/25"
                    : "text-slate-400 hover:text-slate-100 hover:bg-slate-800/60 border border-transparent"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4" />
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800/80 text-[11px] text-slate-500 space-y-1">
          <div className="flex justify-between">
            <span>Bridge local</span>
            <span className="font-mono text-emerald-400">
              {snap.bridgePort ? `:${snap.bridgePort}` : "off"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Telas abertas</span>
            <span className="font-mono text-indigo-300">{openBridges}</span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Summary Bar */}
        <header className="h-14 shrink-0 bg-[#0d101d]/90 border-b border-slate-800/80 px-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-5 text-xs overflow-x-auto">
            <div className="flex items-center gap-1.5">
              <Users className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-400">Online:</span>
              <span className="font-mono font-semibold text-white">
                {onlineCount}/{snap.accounts.length}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-sky-400" />
              <span className="text-slate-400">XP/h:</span>
              <span className="font-mono font-semibold text-sky-300">
                {fmtCompact(totalXpH)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="text-slate-400">Ouro/h:</span>
              <span className="font-mono font-semibold text-amber-300">
                {fmtCompact(totalGoldH)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-yellow-500" />
              <span className="text-slate-400">Total:</span>
              <span className="font-mono font-semibold text-yellow-300">
                {fmtCompact(totalGold)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Gem className="w-4 h-4 text-fuchsia-400" />
              <span className="text-slate-400">Gemas:</span>
              <span className="font-mono font-semibold text-fuchsia-300">
                {fmtCompact(totalOrbs)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {openBridges > 0 ? (
              <button
                onClick={() => api.closeAllGameWindows()}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 border border-slate-700 inline-flex items-center gap-1.5"
              >
                <EyeOff className="w-3.5 h-3.5" /> Fechar Jogos ({openBridges})
              </button>
            ) : (
              <button
                disabled={snap.accounts.length === 0}
                onClick={() => api.openAllGameWindows()}
                className="px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-xs text-white font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
              >
                <Eye className="w-3.5 h-3.5" /> Abrir Deck
              </button>
            )}
          </div>
        </header>

        {/* Workspace Canvas */}
        <main className={tab === "deck" ? "flex-1 overflow-hidden p-0" : "flex-1 overflow-y-auto p-5"}>
          <TabErrorBoundary tabKey={tab}>
          {tab === "dashboard" && (
            <div className="space-y-4">
              {snap.accounts.length === 0 ? (
                <div className="rounded-2xl bg-[#111525] border border-slate-800 p-10 text-center space-y-3 max-w-xl mx-auto mt-10">
                  <div className="text-lg font-semibold text-white">
                    Bem-vindo ao PokeMngr
                  </div>
                  <p className="text-sm text-slate-400">
                    Adicione até 4 contas do <b>pokeidle.io</b> para farmar leve na bandeja do Windows e abrir a visualização ao vivo do personagem quando quiser sem derrubar a sessão (Caminho 1 · Bridge WS).
                  </p>
                  <button
                    onClick={() => setTab("config")}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm transition"
                  >
                    Adicionar Primeira Conta
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {snap.accounts.map((acc) => (
                    <AccountCard
                      key={acc.id}
                      acc={acc}
                      bridgePort={snap.bridgePort}
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
            <DeckView accounts={snap.accounts} onToast={showToast} />
          )}

          {tab === "mapa" && (
            <MapaView
              accounts={snap.accounts}
              bridgePort={snap.bridgePort}
              onToast={showToast}
            />
          )}

          {tab === "inventario" && (
            <InventoryView
              accounts={snap.accounts}
              bridgePort={snap.bridgePort}
              onToast={showToast}
            />
          )}

          {tab === "passe" && (
            <PassView
              accounts={snap.accounts}
              serverTimeMs={snap.serverTimeMs}
              onToast={showToast}
            />
          )}

          {tab === "chat" && (
            <ChatView accounts={snap.accounts} onToast={showToast} />
          )}

          {tab === "mercado" && (
            <MarketView accounts={snap.accounts} onToast={showToast} />
          )}

          {tab === "pvp" && (
            <PvpView bridgePort={snap.bridgePort} onToast={showToast} />
          )}

          {tab === "lives" && <LivesView onToast={showToast} />}

          {tab === "config" && (
            <SettingsView
              settings={settings}
              onSettingsChange={setSettings}
              onToast={showToast}
            />
          )}
          </TabErrorBoundary>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-xl bg-slate-900 border border-amber-500/40 text-amber-200 px-4 py-2.5 text-xs shadow-2xl">
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
