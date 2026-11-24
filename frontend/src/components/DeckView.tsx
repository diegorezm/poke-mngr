import { useEffect, useState } from "react";
import {
  Columns,
  LayoutGrid,
  Maximize2,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  Power,
  Coins,
} from "lucide-react";
import { AccountTelemetry, fmtCompact } from "../lib/types";
import { api } from "../lib/api";

type LayoutMode = "grid" | "columns" | "focus";

export function DeckView({
  accounts,
  onToast,
}: {
  accounts: AccountTelemetry[];
  onToast: (msg: string) => void;
}) {
  const [layout, setLayout] = useState<LayoutMode>("grid");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [zoom, setZoom] = useState<number>(1.0);
  const [hiddenIds, setHiddenIds] = useState<Record<number, boolean>>({});
  const [urls, setUrls] = useState<Record<number, string>>({});

  const accountIdsKey = accounts.map((a) => a.id).join(",");

  useEffect(() => {
    let alive = true;
    accounts.forEach((acc) => {
      if (urls[acc.id]) return;
      api
        .getGameURL(acc.id)
        .then((u) => {
          if (alive) setUrls((prev) => ({ ...prev, [acc.id]: u }));
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [accountIdsKey]);

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
    // grid mode (same logic as pokeidleDeck)
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
      <div className="h-11 shrink-0 bg-[#0d101d] border-b border-slate-800 px-3 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5">
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
                    setHiddenIds((h) => ({ ...h, [a.id]: false }));
                    setFocusId(a.id);
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

        {/* Zoom & Power toggles */}
        <div className="flex items-center gap-2">
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
          const gameUrl = urls[acc.id];
          return (
            <div
              key={acc.id}
              className={`flex flex-col rounded-xl overflow-hidden border border-slate-800 bg-[#0b0e1b] min-h-0 ${spanLast}`}
            >
              {/* Per-account compact header bar */}
              <div className="h-8 shrink-0 bg-[#111525] border-b border-slate-800 px-2.5 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      acc.state === "ONLINE" ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                  <span className="font-semibold text-white truncate">{acc.nick}</span>
                  <span className="text-[11px] font-mono text-amber-300 inline-flex items-center gap-1">
                    <Coins className="w-3 h-3" /> {fmtCompact(acc.gold)}
                  </span>
                  <span className="text-[10px] text-slate-400 truncate hidden sm:inline">
                    {acc.hunt.name || acc.hunt.slug}
                  </span>
                </div>
                <div className="flex items-center gap-1">
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
                    onClick={() => setHiddenIds((h) => ({ ...h, [acc.id]: true }))}
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
                    src={gameUrl}
                    title={`PokeIdle ${acc.nick}`}
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
