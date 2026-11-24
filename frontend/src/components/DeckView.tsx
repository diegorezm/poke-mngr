import { useEffect, useRef, useState } from "react";
import {
  Columns,
  LayoutGrid,
  Maximize2,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  Power,
  Coins,
  Zap,
  Wind,
  MousePointerClick,
  Compass,
  Loader2,
} from "lucide-react";
import { AccountTelemetry, GlobalSettings, HuntExtStatus, fmtCompact } from "../lib/types";
import { api } from "../lib/api";

type LayoutMode = "grid" | "columns" | "focus";

function broadcastDeckCommand(
  frames: Record<number, HTMLIFrameElement | null>,
  type: "setUltra" | "setReduceMotion" | "setEcho",
  value: boolean
) {
  const msg = { __pokeMngr: true, type, value };
  for (const el of Object.values(frames)) {
    const win = el?.contentWindow;
    if (win) {
      win.postMessage(msg, "*");
    }
  }
}

function forwardClickToOtherFrames(
  frames: Record<number, HTMLIFrameElement | null>,
  sourceId: number,
  click: Record<string, unknown>
) {
  const msg = { __pokeMngr: true, type: "replayClick", click };
  for (const [idStr, el] of Object.entries(frames)) {
    if (Number(idStr) === sourceId) continue;
    const win = el?.contentWindow;
    if (win) {
      win.postMessage(msg, "*");
    }
  }
}

function findSourceAccountId(
  frames: Record<number, HTMLIFrameElement | null>,
  source: MessageEventSource | null
): number {
  if (!source) return 0;
  for (const [idStr, el] of Object.entries(frames)) {
    if (el && el.contentWindow === source) {
      return Number(idStr);
    }
  }
  return 0;
}

function syncFrameEcho(el: HTMLIFrameElement | null, echo: boolean) {
  const win = el?.contentWindow;
  if (!win) return;
  win.postMessage({ __pokeMngr: true, type: "setEcho", value: echo }, "*");
}

function formatHuntExtToast(st: HuntExtStatus): string {
  if (st.enabled) {
    return st.version
      ? `Extensão /hunt v${st.version} ativada — recarregando telas do Deck`
      : "Extensão /hunt ativada — recarregando telas do Deck";
  }
  return "Extensão /hunt desativada";
}

function appendReloadNonce(url: string, nonce: number): string {
  if (!url || nonce <= 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}__r=${nonce}`;
}

export function DeckView({
  accounts,
  settings,
  onSettingsChange,
  onToast,
}: {
  accounts: AccountTelemetry[];
  settings: GlobalSettings;
  onSettingsChange: (gs: GlobalSettings) => void;
  onToast: (msg: string) => void;
}) {
  const [layout, setLayout] = useState<LayoutMode>("grid");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number>(1.0);
  const [hiddenIds, setHiddenIds] = useState<Record<number, boolean>>({});
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [echoEnabled, setEchoEnabled] = useState<boolean>(false);
  const [echoNotes, setEchoNotes] = useState<Record<number, string>>({});
  const [huntStatus, setHuntStatus] = useState<HuntExtStatus>({
    enabled: settings.deckHuntExt,
    installed: false,
    version: "",
  });
  const [huntBusy, setHuntBusy] = useState<boolean>(false);
  const [reloadNonce, setReloadNonce] = useState<number>(0);

  const iframeRefs = useRef<Record<number, HTMLIFrameElement | null>>({});
  const echoEnabledRef = useRef<boolean>(false);
  const noteTimersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const accountIdsKey = accounts.map((a) => a.id).join(",");

  useEffect(() => {
    echoEnabledRef.current = echoEnabled;
    broadcastDeckCommand(iframeRefs.current, "setEcho", echoEnabled);
  }, [echoEnabled]);

  useEffect(() => {
    let alive = true;
    api
      .getHuntExtStatus()
      .then((st) => {
        if (alive) setHuntStatus(st);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings.deckHuntExt]);

  useEffect(() => {
    let alive = true;
    accounts.forEach((acc) => {
      if (urls[acc.id]) return;
      const id = acc.id;
      api
        .getGameURL(id)
        .then((u) => {
          if (alive) setUrls((prev) => ({ ...prev, [id]: u }));
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [accountIdsKey]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as Record<string, unknown> | null;
      if (!d || typeof d !== "object" || d.__pokeMngr !== true) return;
      const sourceId = findSourceAccountId(iframeRefs.current, ev.source);
      if (sourceId <= 0) return;
      if (d.type === "deckClick" && echoEnabledRef.current) {
        const click = d.click as Record<string, unknown> | undefined;
        if (click && typeof click === "object") {
          forwardClickToOtherFrames(iframeRefs.current, sourceId, click);
        }
        return;
      }
      if (d.type === "echoMiss") {
        const label = String(d.label || "esse botão");
        const msg = `eco: ${label} não está nesta tela`;
        setEchoNotes((prev) => ({ ...prev, [sourceId]: msg }));
        const prevTimer = noteTimersRef.current[sourceId];
        if (prevTimer) clearTimeout(prevTimer);
        noteTimersRef.current[sourceId] = setTimeout(() => {
          setEchoNotes((prev) => {
            const next = { ...prev };
            delete next[sourceId];
            return next;
          });
        }, 2500);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      for (const t of Object.values(noteTimersRef.current)) {
        clearTimeout(t);
      }
      noteTimersRef.current = {};
    };
  }, []);

  const handleToggleUltra = async () => {
    const nextVal = !settings.deckUltra;
    const nextSettings: GlobalSettings = { ...settings, deckUltra: nextVal };
    const msg = nextVal
      ? "Modo ULTRA ligado em todas as contas"
      : "Modo ULTRA desligado";
    broadcastDeckCommand(iframeRefs.current, "setUltra", nextVal);
    onSettingsChange(nextSettings);
    try {
      await api.updateSettings(nextSettings);
      onToast(msg);
    } catch (e) {
      onToast(`Erro ao salvar ULTRA: ${String(e)}`);
    }
  };

  const handleToggleReduceMotion = async () => {
    const nextVal = !settings.deckReduceMotion;
    const nextSettings: GlobalSettings = { ...settings, deckReduceMotion: nextVal };
    const msg = nextVal
      ? "Menos animações ativado em tempo real"
      : "Animações normais restauradas";
    broadcastDeckCommand(iframeRefs.current, "setReduceMotion", nextVal);
    onSettingsChange(nextSettings);
    try {
      await api.updateSettings(nextSettings);
      onToast(msg);
    } catch (e) {
      onToast(`Erro ao salvar animações: ${String(e)}`);
    }
  };

  const handleToggleEcho = () => {
    const nextVal = !echoEnabled;
    setEchoEnabled(nextVal);
    onToast(
      nextVal
        ? "Eco de cliques LIGADO — cliques em uma conta serão repetidos nas outras"
        : "Eco de cliques desligado"
    );
  };

  const handleToggleHuntExt = async () => {
    const nextVal = !huntStatus.enabled;
    setHuntBusy(true);
    try {
      const st = await api.setHuntExtEnabled(nextVal);
      setHuntStatus(st);
      const nextSettings: GlobalSettings = { ...settings, deckHuntExt: st.enabled };
      onSettingsChange(nextSettings);
      setReloadNonce((n) => n + 1);
      onToast(formatHuntExtToast(st));
    } catch (e) {
      onToast(`Falha na extensão /hunt: ${String(e)}`);
    }
    setHuntBusy(false);
  };

  const activeAccounts = accounts.filter((a) => !hiddenIds[a.id]);
  const visibleAccounts =
    layout === "focus"
      ? activeAccounts.filter((a) => a.id === (focusId ?? activeAccounts[0]?.id))
      : activeAccounts;

  const gridClass = (() => {
    const n = visibleAccounts.length;
    if (layout === "focus" || n <= 1) return "grid-cols-1 grid-rows-1";
    if (layout === "columns") {
      if (n === 2) return "grid-cols-2 grid-rows-1";
      if (n === 3) return "grid-cols-3 grid-rows-1";
      return "grid-cols-4 grid-rows-1";
    }
    if (n === 2) return "grid-cols-2 grid-rows-1";
    return "grid-cols-2 grid-rows-2";
  })();

  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-10 text-center text-sm text-slate-400 max-w-lg mx-auto mt-10">
        Adicione pelo menos uma conta em <b>Contas & Config</b> para visualizar seu personagem aqui no Deck.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Deck Toolbar (pokeidleDeck style) */}
      <div className="h-11 shrink-0 bg-[#0d101d] border-b border-slate-800 px-3 flex items-center justify-between gap-2 text-xs overflow-x-auto">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setLayout("grid")}
            className={`px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5 border ${
              layout === "grid"
                ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                : "bg-slate-800/70 text-slate-400 border-slate-700/70 hover:text-white"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Grade
          </button>
          <button
            onClick={() => setLayout("columns")}
            className={`px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5 border ${
              layout === "columns"
                ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                : "bg-slate-800/70 text-slate-400 border-slate-700/70 hover:text-white"
            }`}
          >
            <Columns className="w-3.5 h-3.5" /> Colunas
          </button>
          <button
            onClick={() => {
              setLayout("focus");
              if (focusId == null && activeAccounts[0]) setFocusId(activeAccounts[0].id);
            }}
            className={`px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5 border ${
              layout === "focus"
                ? "bg-amber-500/20 text-amber-300 border-amber-500/30"
                : "bg-slate-800/70 text-slate-400 border-slate-700/70 hover:text-white"
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" /> Foco
          </button>

          {layout === "focus" && (
            <div className="flex items-center gap-1 ml-2 pl-2 border-l border-slate-800">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  onClick={() => {
                    const id = a.id;
                    setHiddenIds((h) => ({ ...h, [id]: false }));
                    setFocusId(id);
                  }}
                  className={`px-2 py-1 rounded-md ${
                    (focusId ?? activeAccounts[0]?.id) === a.id
                      ? "bg-indigo-500/30 text-indigo-200"
                      : "text-slate-400 hover:bg-slate-800"
                  }`}
                >
                  {a.nick}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Performance, Echo, /hunt, Zoom & Power */}
        <div className="flex items-center gap-1.5 shrink-0">
          {visibleAccounts.length > 1 && (
            <button
              onClick={handleToggleEcho}
              title="Eco de cliques (opt-in): repete cliques em botões nas outras contas abertas (texto digitado nunca é repetido)"
              className={`px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5 border transition ${
                echoEnabled
                  ? "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-500/45 shadow-sm shadow-fuchsia-500/20"
                  : "bg-slate-800/70 text-slate-400 border-slate-700/70 hover:text-white"
              }`}
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              {echoEnabled ? "Eco ON" : "Eco"}
            </button>
          )}
          <button
            disabled={huntBusy}
            onClick={handleToggleHuntExt}
            title={
              huntStatus.version
                ? `Extensão /hunt for PokeIdle v${huntStatus.version} (baixa da loja Firefox + ponte /api/wishlist)`
                : "Ativar extensão /hunt for PokeIdle (baixa .xpi oficial da loja Firefox + ponte /api/wishlist)"
            }
            className={`px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5 border transition disabled:opacity-60 ${
              huntStatus.enabled
                ? "bg-amber-500/20 text-amber-200 border-amber-500/45"
                : "bg-slate-800/70 text-slate-400 border-slate-700/70 hover:text-white"
            }`}
          >
            {huntBusy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Compass className="w-3.5 h-3.5" />
            )}
            /hunt{huntStatus.version ? ` v${huntStatus.version}` : ""}
          </button>
          <button
            onClick={handleToggleUltra}
            title="Alternar Modo ULTRA Economia em tempo real nas contas abertas"
            className={`px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5 border transition ${
              settings.deckUltra
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                : "bg-slate-800/70 text-slate-400 border-slate-700/70 hover:text-white"
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            {settings.deckUltra ? "ULTRA ON" : "ULTRA"}
          </button>
          <button
            onClick={handleToggleReduceMotion}
            title="Alternar redução de animações (prefers-reduced-motion) sem recarregar"
            className={`px-2.5 py-1 rounded-lg inline-flex items-center gap-1.5 border transition ${
              settings.deckReduceMotion
                ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                : "bg-slate-800/70 text-slate-400 border-slate-700/70 hover:text-white"
            }`}
          >
            <Wind className="w-3.5 h-3.5" />
            Menos animações
          </button>
          <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-800 px-1.5 py-0.5">
            <button
              onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.1).toFixed(2))))}
              className="p-1 text-slate-400 hover:text-white"
              title="Diminuir zoom"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono w-10 text-center text-slate-300">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(1.5, Number((z + 0.1).toFixed(2))))}
              className="p-1 text-slate-400 hover:text-white"
              title="Aumentar zoom"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
          {accounts.some((a) => hiddenIds[a.id]) && (
            <button
              onClick={() => setHiddenIds({})}
              className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
            >
              Mostrar todas
            </button>
          )}
        </div>
      </div>

      {/* Multi-Account Game Panes */}
      <div className={`flex-1 grid gap-1 p-1 bg-[#06080f] min-h-0 ${gridClass}`}>
        {visibleAccounts.map((acc, idx) => {
          const spanLast =
            layout === "grid" && visibleAccounts.length === 3 && idx === 2
              ? "col-span-2"
              : "";
          const gameUrl = appendReloadNonce(urls[acc.id] || "", reloadNonce);
          const echoNote = echoNotes[acc.id];
          return (
            <div
              key={acc.id}
              className={`flex flex-col rounded-xl overflow-hidden border bg-[#0b0e1b] min-h-0 ${
                echoEnabled ? "border-fuchsia-500/35" : "border-slate-800"
              } ${spanLast}`}
            >
              {/* Per-account compact header bar */}
              <div className="h-8 shrink-0 bg-[#111525] border-b border-slate-800 px-2.5 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      acc.state === "ONLINE" ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                  <span className="font-semibold text-white truncate">{acc.nick}</span>
                  <span className="text-[11px] font-mono text-amber-300 inline-flex items-center gap-1 shrink-0">
                    <Coins className="w-3 h-3" /> {fmtCompact(acc.gold)}
                  </span>
                  {echoNote ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/20 text-fuchsia-200 border border-fuchsia-500/30 truncate">
                      {echoNote}
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 truncate hidden sm:inline">
                      {acc.hunt.name || acc.hunt.slug}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      if (layout === "focus") {
                        setLayout("grid");
                      } else {
                        setFocusId(acc.id);
                        setLayout("focus");
                      }
                    }}
                    title="Ampliar / Focar"
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                  >
                    <Maximize2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() =>
                      api
                        .openGameWindow(acc.id)
                        .catch((e) => onToast(`Erro: ${String(e)}`))
                    }
                    title="Abrir em janela separada"
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      const id = acc.id;
                      setHiddenIds((h) => ({ ...h, [id]: true }));
                    }}
                    title="Ocultar tela (continua farmando em segundo plano)"
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-300"
                  >
                    <Power className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Embedded Live Game via Local Same-Origin Bridge */}
              <div className="flex-1 relative overflow-hidden bg-black">
                {gameUrl ? (
                  <iframe
                    ref={(el) => {
                      const id = acc.id;
                      iframeRefs.current[id] = el;
                    }}
                    src={gameUrl}
                    title={`PokeIdle ${acc.nick}`}
                    onLoad={(e) => syncFrameEcho(e.currentTarget, echoEnabled)}
                    className="border-0 origin-top-left"
                    style={{
                      width: `${100 / zoom}%`,
                      height: `${100 / zoom}%`,
                      transform: `scale(${zoom})`,
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs text-slate-500">
                    Carregando Bridge...
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
