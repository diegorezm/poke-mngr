import { useState } from "react";
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

  const bySlug = new Map(hunts.map((h) => [h.slug, h]));
  const ranked = rankLines(best?.lines, order).filter((l) => bySlug.has(l.slug));
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
    <section className="px-box overflow-hidden">
      <div className="bg-[#1b1f26] border-b-[1.5px] border-[var(--border-dark)] px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-[#282e39] border border-[#3a4252] flex items-center justify-center shrink-0">
            {sheet ? (
              <PokemonSprite
                looktype={sheet.looktype}
                bridgePort={bridgePort}
                size={34}
                shiny={sheet.shiny}
              />
            ) : (
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[#facc15] shrink-0" />
              <span className="truncate">
                Melhor hunt para {sheet ? sheet.nome : "o Pokémon equipado"}
              </span>
            </h3>
            <p className="text-xs text-slate-400 font-medium">
              {sheet ? `Lv ${sheet.level} · conta ${nick}` : `Conta ${nick}`}
            </p>
          </div>
        </div>

        {/* XP/h vs Ouro/h Toggle */}
        <div className="flex items-center gap-1.5 text-xs">
          <button
            onClick={() => onOrder("xp")}
            className={`ds-btn ds-btn-sm ${
              order === "xp" ? "ds-btn-blue" : "ds-btn-slate"
            }`}
          >
            <Zap className="w-3.5 h-3.5" /> XP/h
          </button>
          <button
            onClick={() => onOrder("ouro")}
            className={`ds-btn ds-btn-sm ${
              order === "ouro" ? "ds-btn-orange" : "ds-btn-slate"
            }`}
          >
            <Coins className="w-3.5 h-3.5" /> Ouro/h
          </button>
          <button
            onClick={onRetry}
            title="Recalcular melhores hunts"
            className="ds-btn ds-btn-slate ds-btn-sm !px-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {!online ? (
          <div className="px-inset px-3 py-2.5 text-xs text-[var(--ink-muted)] font-medium">
            Conecte a conta para calcular a melhor hunt do Pokémon equipado.
          </div>
        ) : error && !best ? (
          <div className="rounded-lg bg-red-500/10 border border-red-500/35 px-3 py-2 text-xs text-[var(--ink-accent-rose)] font-semibold flex items-center justify-between gap-2">
            <span>{error}</span>
            <button onClick={onRetry} className="ds-btn ds-btn-slate ds-btn-sm">
              Tentar de novo
            </button>
          </div>
        ) : !best ? (
          <div className="px-inset px-3 py-2.5 text-xs text-[var(--ink-muted)] font-medium flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--dex-red)]" />
            Calculando as melhores hunts no simulador PokéIdle Hub...
          </div>
        ) : ranked.length === 0 ? (
          <div className="px-inset px-3 py-2.5 text-xs text-[var(--ink-muted)] font-medium">
            Nenhuma hunt liberada rende com esse Pokémon agora.
          </div>
        ) : (
          <>
            {/* Comparison Banner */}
            {cur && (
              <div
                className={`rounded-lg border px-3 py-2 text-xs font-semibold flex flex-wrap items-center gap-1.5 ${
                  gain < 0.05
                    ? "bg-emerald-500/12 border-emerald-600/35 text-[var(--ink-accent-green)]"
                    : "bg-amber-500/12 border-amber-600/35 text-[var(--ink)]"
                }`}
              >
                {gain < 0.05 ? (
                  <>
                    <Check className="w-4 h-4 shrink-0" />
                    <span>Você já está caçando numa das melhores hunts!</span>
                  </>
                ) : (
                  <>
                    <span>
                      Hoje em <b>{cur.nome}</b>:{" "}
                      <b className="font-mono-num">{fmtCompact(curMetric)}</b> {unit}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
                    <span>
                      em <b>{top?.nome}</b> rende{" "}
                      <b className="font-mono-num text-[var(--ink-accent-green)]">
                        +{Math.round(gain * 100)}%
                      </b>
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Top Ranked Hunts */}
            <div className="space-y-2">
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
                    className={`dex-row px-3 py-2 flex items-center justify-between gap-3 cursor-pointer ${
                      isCur ? "dex-row-active" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-7 h-7 rounded-md font-mono-num text-xs font-bold flex items-center justify-center shrink-0 ${
                          idx === 0
                            ? "bg-[#1b1f26] text-[#fde047]"
                            : idx === 1
                            ? "bg-slate-300 text-slate-900"
                            : idx === 2
                            ? "bg-amber-700 text-white"
                            : "bg-[var(--panel-deep)] text-[var(--ink-muted)]"
                        }`}
                      >
                        #{idx + 1}
                      </span>
                      <PokemonSprite
                        looktype={h.mainLook}
                        bridgePort={bridgePort}
                        size={34}
                        className="px-stage shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-xs text-[var(--ink)] truncate">
                            {h.nome || l.nome}
                          </span>
                          <span className="font-mono-num text-[10px] text-[var(--ink-subtle)] uppercase">
                            {h.regiao}
                          </span>
                          {l.umHit ? (
                            <span className="font-mono-num text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-600 text-white">
                              1-Hit
                            </span>
                          ) : l.mortesH > 0 ? (
                            <span className="font-mono-num text-[10px] font-bold px-1.5 py-0.2 rounded bg-red-600 text-white inline-flex items-center gap-0.5">
                              <Skull className="w-2.5 h-2.5" /> {l.mortesH.toFixed(1)}/h
                            </span>
                          ) : null}
                        </div>
                        <div className="text-[11px] text-[var(--ink-muted)] font-medium">
                          {Math.round(l.kph).toLocaleString("pt-BR")} abates/h · {otherTxt}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div
                          className={`font-mono-num text-sm font-bold ${
                            order === "ouro"
                              ? "text-[var(--ink-accent-amber)]"
                              : "text-[var(--ink-accent-sky)]"
                          }`}
                        >
                          {fmtCompact(mainVal)}
                        </div>
                        <div className="text-[10px] text-[var(--ink-subtle)]">{unit}</div>
                      </div>

                      <button
                        disabled={isCur}
                        onClick={(e) => {
                          e.stopPropagation();
                          onHunt(h);
                        }}
                        className={`ds-btn ds-btn-sm ${
                          isCur
                            ? "ds-btn-slate"
                            : isPend
                            ? "ds-btn-orange"
                            : "ds-btn-blue"
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

            <div className="flex items-center justify-between text-[11px] text-[var(--ink-muted)] pt-0.5">
              {ranked.length > SHOWN ? (
                <button
                  onClick={() => setMore((v) => !v)}
                  className="font-bold text-[var(--dex-red)] hover:underline cursor-pointer"
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
      </div>
    </section>
  );
}
