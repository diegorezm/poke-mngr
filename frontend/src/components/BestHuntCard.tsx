import { useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  Loader2,
  Play,
  Sparkles,
  Skull,
  Zap,
  Coins,
  RefreshCw,
} from "lucide-react";
import { HuntInfo, fmtCompact } from "../lib/types";
import {
  BestHunts,
  HuntOrder,
  lineMetric,
  rankLines,
} from "../lib/huntAdvisor";
import { PokemonSprite } from "./PokemonSprite";

const SHOWN = 3;
const MAX = 10;

export function BestHuntCard({
  nick,
  bridgePort,
  order,
  onOrder,
  best,
  loading,
  error,
  onRetry,
  online,
  hunts,
  currentSlug,
  pendingSlug,
  onFocus,
  onHunt,
}: {
  nick: string;
  bridgePort: number;
  order: HuntOrder;
  onOrder: (o: HuntOrder) => void;
  best: BestHunts | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  online: boolean;
  hunts: HuntInfo[];
  currentSlug: string;
  pendingSlug: string;
  onFocus: (slug: string) => void;
  onHunt: (h: HuntInfo) => void;
}) {
  const [more, setMore] = useState(false);

  const bySlug = useMemo(() => new Map(hunts.map((h) => [h.slug, h])), [hunts]);
  const ranked = useMemo(
    () => rankLines(best?.lines, order).filter((l) => bySlug.has(l.slug)),
    [best, order, bySlug]
  );
  const shown = ranked.slice(0, more ? MAX : SHOWN);

  const sheet = best?.sheet;
  const cur = best?.lines.find((l) => l.slug === currentSlug);
  const top = ranked[0];
  const curMetric = cur ? lineMetric(cur, order) : 0;
  const gain =
    top && curMetric > 0 && top.slug !== cur?.slug
      ? lineMetric(top, order) / curMetric - 1
      : 0;
  const unit = order === "ouro" ? "ouro/h" : "XP/h";

  return (
    <section className="rounded-2xl bg-[#111525] border border-amber-500/25 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full bg-[#090c18] border border-amber-500/40 flex items-center justify-center shrink-0">
            {sheet ? (
              <PokemonSprite
                looktype={sheet.looktype}
                bridgePort={bridgePort}
                size={38}
                shiny={sheet.shiny}
              />
            ) : (
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="truncate">
                Melhor hunt para {sheet ? sheet.nome : "o Pokémon equipado"}
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              {sheet ? `Lv ${sheet.level} · conta ${nick}` : `Conta ${nick}`}
            </p>
          </div>
        </div>

        {/* XP/h vs Ouro/h Toggle */}
        <div className="flex items-center gap-1.5 text-xs">
          <button
            onClick={() => onOrder("xp")}
            className={`px-3 py-1.5 rounded-xl font-semibold border inline-flex items-center gap-1.5 transition ${
              order === "xp"
                ? "bg-sky-500/25 text-sky-200 border-sky-400/50"
                : "bg-[#0b0e1b] text-slate-400 border-slate-800 hover:text-white"
            }`}
          >
            <Zap className="w-3.5 h-3.5" /> XP/h
          </button>
          <button
            onClick={() => onOrder("ouro")}
            className={`px-3 py-1.5 rounded-xl font-semibold border inline-flex items-center gap-1.5 transition ${
              order === "ouro"
                ? "bg-amber-500/25 text-amber-200 border-amber-400/50"
                : "bg-[#0b0e1b] text-slate-400 border-slate-800 hover:text-white"
            }`}
          >
            <Coins className="w-3.5 h-3.5" /> Ouro/h
          </button>
          <button
            onClick={onRetry}
            title="Recalcular melhores hunts"
            className="p-1.5 rounded-xl bg-[#0b0e1b] border border-slate-800 text-slate-400 hover:text-white"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {!online ? (
        <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 px-3 py-2.5 text-xs text-slate-400">
          Conecte a conta para calcular a melhor hunt do Pokémon equipado.
        </div>
      ) : error && !best ? (
        <div className="rounded-xl bg-rose-500/10 border border-rose-500/25 px-3 py-2.5 text-xs text-rose-200 flex items-center justify-between gap-2">
          <span>{error}</span>
          <button
            onClick={onRetry}
            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white"
          >
            Tentar de novo
          </button>
        </div>
      ) : !best ? (
        <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 px-3 py-2.5 text-xs text-slate-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
          Calculando as melhores hunts no simulador PokéIdle Hub...
        </div>
      ) : ranked.length === 0 ? (
        <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 px-3 py-2.5 text-xs text-slate-400">
          Nenhuma hunt liberada rende com esse Pokémon agora.
        </div>
      ) : (
        <>
          {/* Comparison Banner */}
          {cur && (
            <div
              className={`rounded-xl px-3 py-2 text-xs flex flex-wrap items-center gap-1.5 border ${
                gain < 0.05
                  ? "bg-emerald-500/10 border-emerald-500/35 text-emerald-300"
                  : "bg-[#0b0e1b] border-slate-800 text-slate-300"
              }`}
            >
              {gain < 0.05 ? (
                <>
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <b>Você já está caçando numa das melhores hunts!</b>
                </>
              ) : (
                <>
                  <span>
                    Hoje em <b className="text-white">{cur.nome}</b>:{" "}
                    <b className="font-mono text-white">{fmtCompact(curMetric)}</b> {unit}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    em <b className="text-white">{top?.nome}</b> rende{" "}
                    <b className="font-mono text-emerald-400">
                      +{Math.round(gain * 100)}%
                    </b>
                  </span>
                </>
              )}
            </div>
          )}

          {/* Top Ranked Hunts */}
          <div className="space-y-1.5">
            {shown.map((l, idx) => {
              const h = bySlug.get(l.slug)!;
              const isCur = l.slug === currentSlug;
              const isPend = l.slug === pendingSlug;
              const mainVal = lineMetric(l, order);
              const otherTxt =
                order === "ouro"
                  ? `XP ${fmtCompact(l.xpPokemonH)}/h`
                  : `Ouro ${fmtCompact(l.ouroH)}/h`;
              return (
                <div
                  key={l.slug}
                  onClick={() => onFocus(l.slug)}
                  className={`rounded-xl border px-3 py-2 flex items-center justify-between gap-3 cursor-pointer transition ${
                    isCur
                      ? "bg-emerald-500/10 border-emerald-500/40"
                      : "bg-[#0b0e1b] border-slate-800 hover:border-amber-500/40"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={`w-6 h-6 rounded-lg font-mono text-xs font-bold flex items-center justify-center shrink-0 ${
                        idx === 0
                          ? "bg-amber-400 text-slate-950"
                          : idx === 1
                          ? "bg-slate-300 text-slate-950"
                          : idx === 2
                          ? "bg-amber-700 text-white"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      #{idx + 1}
                    </span>
                    <PokemonSprite
                      looktype={h.mainLook}
                      bridgePort={bridgePort}
                      size={34}
                      className="rounded-lg bg-[#111525] border border-slate-800"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-xs text-white truncate">
                          {h.nome || l.nome}
                        </span>
                        <span className="text-[10px] text-slate-500 uppercase">
                          {h.regiao}
                        </span>
                        {l.umHit ? (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                            1-Hit
                          </span>
                        ) : l.mortesH > 0 ? (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 inline-flex items-center gap-0.5">
                            <Skull className="w-2.5 h-2.5" /> {l.mortesH.toFixed(1)}/h
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {Math.round(l.kph).toLocaleString("pt-BR")} abates/h · {otherTxt}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div
                        className={`text-sm font-mono font-bold ${
                          order === "ouro" ? "text-amber-300" : "text-sky-300"
                        }`}
                      >
                        {fmtCompact(mainVal)}
                      </div>
                      <div className="text-[10px] text-slate-500">{unit}</div>
                    </div>

                    <button
                      disabled={isCur}
                      onClick={(e) => {
                        e.stopPropagation();
                        onHunt(h);
                      }}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1 ${
                        isCur
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : isPend
                          ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          : "bg-indigo-500 hover:bg-indigo-400 text-white"
                      }`}
                    >
                      {isCur ? (
                        "Ativa"
                      ) : isPend ? (
                        "Na fila"
                      ) : (
                        <>
                          <Play className="w-3 h-3" /> Caçar
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5">
            {ranked.length > SHOWN ? (
              <button
                onClick={() => setMore((v) => !v)}
                className="text-amber-300 hover:underline font-medium"
              >
                {more
                  ? "Mostrar menos"
                  : `Mostrar Top ${Math.min(MAX, ranked.length)}`}
              </button>
            ) : (
              <span />
            )}
            <span>
              Simulador PokéIdle Hub{best.versao ? ` (${best.versao})` : ""} · sem VIP/boosts
            </span>
          </div>
        </>
      )}
    </section>
  );
}
