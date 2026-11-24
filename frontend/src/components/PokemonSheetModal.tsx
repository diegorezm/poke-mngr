import { X, Swords, Shield, Heart, Target, GitBranch, ShoppingCart } from "lucide-react";
import { ListingDetail, PokemonDetail, fmtCompact } from "../lib/types";
import { TYPE_COLOR } from "../lib/gameData";
import { PokemonSprite } from "./PokemonSprite";

export const GRADE_COLORS: Record<string, string> = {
  "extremamente-fraco": "text-slate-400",
  fraco: "text-slate-300",
  mediano: "text-sky-300",
  razoavel: "text-cyan-300",
  bom: "text-emerald-300",
  forte: "text-lime-300",
  poderoso: "text-amber-300",
  mitico: "text-orange-400",
  legendario: "text-fuchsia-400",
  divino: "text-yellow-300",
};

const STAT_LABELS: [string, string][] = [
  ["hp", "HP"],
  ["atk", "ATK"],
  ["def", "DEF"],
  ["spAtk", "SpA"],
  ["spDef", "SpD"],
  ["speed", "SPD"],
];

function rangeLabel(alcance: number): string {
  if (alcance <= 1) return "1 (Corpo a corpo)";
  return `${alcance} (Distância)`;
}

export function PokemonSheetModal({
  sheet,
  bridgePort,
  listing,
  onBuy,
  buying,
  onClose,
}: {
  sheet: PokemonDetail;
  bridgePort: number;
  listing?: ListingDetail | null;
  onBuy?: () => void;
  buying?: boolean;
  onClose: () => void;
}) {
  const ownerLabel = sheet.owner || sheet.accountNick || "?";
  const evolutions = sheet.evolucoes || [];
  const nextSteps = sheet.evoNext || [];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#111525] border border-slate-700 shadow-2xl p-5 space-y-4"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <PokemonSprite
              looktype={sheet.looktype}
              bridgePort={bridgePort}
              size={64}
              shiny={sheet.shiny}
              className="rounded-xl bg-[#090c18] border border-slate-800 shrink-0"
            />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-white">
                  {sheet.apelido || sheet.nome}
                  {sheet.shiny ? " ✨" : ""}
                </h3>
                <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-amber-300">
                  Lv {sheet.level}
                </span>
              </div>
              <div className="text-xs text-slate-400">
                {ownerLabel} · Potência P{sheet.potencia} · Qualidade{" "}
                {sheet.qualidade.toFixed(2)}
              </div>
              <div className="flex gap-1 mt-1 flex-wrap">
                {(sheet.tipos || []).map((t) => (
                  <span
                    key={t}
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                    style={{ backgroundColor: TYPE_COLOR[t.toUpperCase()] || "#475569" }}
                  >
                    {t.toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Combat Power Cards (PvP / PvE / Combat HP / Range) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-2.5">
            <div className="text-[10px] text-slate-400 flex items-center gap-1">
              <Swords className="w-3 h-3 text-rose-400" /> Poder PvP
            </div>
            <div className="font-mono font-bold text-rose-300 text-sm mt-0.5">
              {sheet.pvpPower > 0 ? fmtCompact(sheet.pvpPower) : "—"}
            </div>
            <div className="text-[10px] text-slate-500">
              Arena Lv {sheet.pvpLevel || sheet.level}
            </div>
          </div>
          <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-2.5">
            <div className="text-[10px] text-slate-400 flex items-center gap-1">
              <Shield className="w-3 h-3 text-amber-400" /> Poder PvE
            </div>
            <div className="font-mono font-bold text-amber-300 text-sm mt-0.5">
              {sheet.pvePower > 0 ? fmtCompact(sheet.pvePower) : "—"}
            </div>
            <div className="text-[10px] text-slate-500">Nível real</div>
          </div>
          <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-2.5">
            <div className="text-[10px] text-slate-400 flex items-center gap-1">
              <Heart className="w-3 h-3 text-emerald-400" /> HP Combate
            </div>
            <div className="font-mono font-bold text-emerald-300 text-sm mt-0.5">
              {sheet.combatHp > 0 ? fmtCompact(sheet.combatHp) : "—"}
            </div>
            <div className="text-[10px] text-slate-500">Stat ×12</div>
          </div>
          <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-2.5">
            <div className="text-[10px] text-slate-400 flex items-center gap-1">
              <Target className="w-3 h-3 text-sky-400" /> Alcance PvP
            </div>
            <div className="font-mono font-bold text-sky-300 text-sm mt-0.5">
              {sheet.alcance || 1}
            </div>
            <div className="text-[10px] text-slate-500 truncate">
              {rangeLabel(sheet.alcance || 1)}
            </div>
          </div>
        </div>

        {/* Birth Grade Meter */}
        <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-3 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">Nota de Nascença</span>
            <span className={`font-bold uppercase ${GRADE_COLORS[sheet.faixa] || "text-white"}`}>
              {sheet.nota.toFixed(2)} / 10 ({sheet.faixa})
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-500 via-emerald-400 to-amber-400"
              style={{ width: `${Math.min(100, sheet.nota * 10)}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>
              Mercado:{" "}
              <b className={sheet.mercadoOk ? "text-emerald-400" : "text-rose-400"}>
                {sheet.mercadoOk ? "Elegível" : "Abaixo de 3.5"}
              </b>
            </span>
            <span>
              IV Total: <b className="text-white">{sheet.ivSoma}/192</b> (
              {sheet.ivPct.toFixed(1)}%)
            </span>
          </div>
        </div>

        {/* Hexagonal IV Radar + Stat Bars */}
        <div className="grid grid-cols-2 gap-4 items-center">
          <IVRadar ivs={sheet.ivs} />
          <div className="space-y-1.5 text-xs">
            {STAT_LABELS.map(([k, lbl]) => {
              const iv = sheet.ivs[k] || 0;
              const pct = Math.min(100, (iv / 32) * 100);
              return (
                <div key={k} className="space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-slate-400">{lbl}</span>
                    <span className="font-mono text-slate-200">
                      {iv}/32{" "}
                      {sheet.stats[k] ? (
                        <span className="text-slate-500">({sheet.stats[k]})</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full ${
                        iv >= 28
                          ? "bg-amber-400"
                          : iv >= 20
                          ? "bg-emerald-400"
                          : "bg-sky-400"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Branched / Final Evolutions Projection */}
        {(sheet.evoPrev || nextSteps.length > 0 || evolutions.length > 0) && (
          <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-3 space-y-2.5 text-xs">
            <div className="font-semibold text-slate-200 flex items-center gap-1.5">
              <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
              Evoluções & Projeção Final
              {sheet.evoPrev && (
                <span className="text-[11px] font-normal text-slate-400 ml-auto">
                  De: <b className="text-slate-200">{sheet.evoPrev.nome}</b>
                  {sheet.evoPrev.level > 0 ? ` (Lv ${sheet.evoPrev.level})` : ""}
                </span>
              )}
            </div>

            {evolutions.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {evolutions.map((evo) => (
                  <div
                    key={evo.pokeId}
                    className="rounded-lg bg-[#111525] border border-slate-800 px-2.5 py-2 flex items-center gap-2.5"
                  >
                    <PokemonSprite
                      looktype={evo.looktype}
                      bridgePort={bridgePort}
                      size={36}
                      shiny={sheet.shiny}
                      className="rounded bg-[#090c18] border border-slate-800 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-white truncate">{evo.nome}</div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5 flex-wrap">
                        <span className={GRADE_COLORS[evo.faixa] || "text-slate-300"}>
                          Nota <b>{evo.nota.toFixed(2)}</b>
                        </span>
                        <span>·</span>
                        <span className="text-rose-300 font-mono">
                          PvP {fmtCompact(evo.pvpPower)}
                        </span>
                        <span>·</span>
                        <span className="text-sky-300 font-mono">Alc {evo.alcance}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : nextSteps.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {nextSteps.map((st) => (
                  <span
                    key={st.pokeId}
                    className="px-2 py-1 rounded-lg bg-[#111525] border border-slate-800 text-slate-200"
                  >
                    → {st.nome} {st.level > 0 ? `(Lv ${st.level})` : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {/* Optional Market Listing Footer (when opened from Chat ad) */}
        {listing && (
          <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 flex items-center justify-between gap-3 text-xs">
            <div>
              <div className="text-slate-300">
                Anúncio <span className="font-mono text-white">#{listing.id}</span> · Vendedor:{" "}
                <b className="text-white">{listing.vendedor || "?"}</b>
              </div>
              <div className="font-mono text-base font-bold text-amber-300">
                {fmtCompact(listing.preco)} {listing.moeda === "orb" ? "Gemas" : "Gold"}
              </div>
            </div>
            {onBuy && (
              <button
                disabled={buying}
                onClick={onBuy}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <ShoppingCart className="w-4 h-4" />
                {buying ? "Comprando..." : "Comprar Agora"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function IVRadar({ ivs }: { ivs: Record<string, number> }) {
  const cx = 80;
  const cy = 80;
  const r = 56;
  const pts = STAT_LABELS.map(([k], i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
    const ratio = Math.min(1, Math.max(0.08, (ivs[k] || 0) / 32));
    return {
      x: cx + Math.cos(angle) * r * ratio,
      y: cy + Math.sin(angle) * r * ratio,
      lx: cx + Math.cos(angle) * (r + 16),
      ly: cy + Math.sin(angle) * (r + 16),
      gx: cx + Math.cos(angle) * r,
      gy: cy + Math.sin(angle) * r,
      label: STAT_LABELS[i][1],
    };
  });
  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const outer = pts.map((p) => `${p.gx},${p.gy}`).join(" ");
  return (
    <svg viewBox="0 0 160 160" className="w-40 h-40 mx-auto">
      <polygon points={outer} fill="#0b0e1b" stroke="#334155" strokeWidth="1" />
      {pts.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.gx} y2={p.gy} stroke="#1e293b" strokeWidth="1" />
      ))}
      <polygon
        points={poly}
        fill="rgba(99, 102, 241, 0.35)"
        stroke="#818cf8"
        strokeWidth="2"
      />
      {pts.map((p, i) => (
        <text
          key={i}
          x={p.lx}
          y={p.ly}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="9"
          fill="#94a3b8"
        >
          {p.label}
        </text>
      ))}
    </svg>
  );
}
