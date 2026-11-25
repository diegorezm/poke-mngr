import { useState } from "react";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { X, Swords, Shield, Heart, Target, GitBranch, ShoppingCart, Copy, Check } from "lucide-react";
import { ListingDetail, PokemonDetail, fmtCompact } from "../lib/types";
import { buildPokemonAIPrompt, copyTextToClipboard } from "../lib/pokemonPrompt";
import { PokemonSprite } from "./PokemonSprite";
import { DsBar, DsDialog, DsTypeBadge, MiniBall } from "./DsPrimitives";

export const GRADE_COLORS: Record<string, string> = {
  "extremamente-fraco": "text-[var(--ink-subtle)]",
  fraco: "text-[var(--ink-muted)]",
  mediano: "text-[var(--ink-accent-sky)]",
  razoavel: "text-[var(--ink-accent-sky)]",
  bom: "text-[var(--ink-accent-green)]",
  forte: "text-[var(--ink-accent-green)]",
  poderoso: "text-[var(--ink-accent-amber)]",
  mitico: "text-[#ea580c]",
  legendario: "text-[var(--ink-accent-fuchsia)]",
  divino: "text-[#ca8a04]",
};

export const GRADE_PILL_BG: Record<string, string> = {
  "extremamente-fraco": "bg-slate-600",
  fraco: "bg-slate-600",
  mediano: "bg-blue-600",
  razoavel: "bg-cyan-600",
  bom: "bg-emerald-600",
  forte: "bg-green-600",
  poderoso: "bg-amber-600",
  mitico: "bg-orange-600",
  legendario: "bg-purple-600",
  divino: "bg-yellow-600",
};

const STAT_LABELS: [string, string, string][] = [
  ["hp", "HP", "HP"],
  ["atk", "Attack", "ATK"],
  ["def", "Defense", "DEF"],
  ["spAtk", "Sp. Atk", "SpA"],
  ["spDef", "Sp. Def", "SpD"],
  ["speed", "Speed", "SPD"],
];

function rangeLabel(alcance: number): string {
  if (alcance <= 1) return "1 (Corpo a corpo)";
  return `${alcance} (Distância)`;
}

function ivRankLabel(iv: number): string {
  if (iv >= 32) return "MAX";
  if (iv >= 28) return "S";
  if (iv >= 22) return "A";
  if (iv >= 14) return "B";
  return "C";
}

function hasAnyStats(stats: Record<string, number>): boolean {
  for (const [k] of STAT_LABELS) {
    if ((stats[k] || 0) > 0) return true;
  }
  return false;
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
  const [copiedAI, setCopiedAI] = useState(false);

  const ownerLabel = sheet.owner || sheet.accountNick || "?";
  const evolutions = sheet.evolucoes || [];
  const nextSteps = sheet.evoNext || [];
  const gradeBg = GRADE_PILL_BG[sheet.faixa] || "bg-slate-600";

  const handleCopyForAI = async () => {
    const markdown = buildPokemonAIPrompt(sheet, listing);
    const ok = await copyTextToClipboard(markdown);
    if (ok) {
      setCopiedAI(true);
      setTimeout(() => setCopiedAI(false), 2200);
    }
  };

  return (
    <DsDialog open onClose={onClose} maxWidthClass="max-w-4xl">
      <div className="px-box overflow-hidden shadow-2xl">
        <TabGroup>
          {/* Pokédex Red Edition Top Bezel + Clean Tabs */}
          <div className="bg-gradient-to-b from-[#e04338] to-[#c72d23] border-b-[1.5px] border-[#1b1f26] px-5 py-3.5 flex items-center justify-between gap-2 flex-wrap">
            <div className="ds-ribbon-pill text-white text-sm">
              <MiniBall />
              <span>Ficha Pokédex · {sheet.apelido || sheet.nome}</span>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <TabList className="flex items-center gap-1.5">
                <Tab className="skills-tab focus:outline-none">IVs &amp; Stats</Tab>
                <Tab className="skills-tab focus:outline-none">Combate</Tab>
                <Tab className="skills-tab focus:outline-none">Evoluções</Tab>
              </TabList>
              <button
                type="button"
                onClick={handleCopyForAI}
                title="Copiar ficha completa em Markdown para colar em uma IA (ChatGPT, Claude, Gemini...)"
                className={`ml-1 ds-btn ds-btn-sm ${
                  copiedAI ? "ds-btn-green" : "ds-btn-slate"
                }`}
              >
                {copiedAI ? (
                  <>
                    <Check className="w-3.5 h-3.5" /> Copiado!
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> Copiar p/ IA
                  </>
                )}
              </button>
              <button
                onClick={onClose}
                title="Fechar ficha"
                className="ds-btn ds-btn-slate ds-btn-sm !px-2"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 2-Column Body */}
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] bg-[var(--panel-bg)]">
            {/* Left Sprite Stage */}
            <div className="border-b md:border-b-0 md:border-r border-[var(--border-mid)] p-5 flex flex-col gap-3.5 bg-[var(--panel-alt)]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-num text-xs font-bold bg-[#1b1f26] text-[#fde047] px-2.5 py-0.5 rounded">
                  Lv.{sheet.level}
                </span>
                <span
                  className={`font-mono-num text-[10px] font-bold uppercase px-2.5 py-0.5 rounded text-white ${gradeBg}`}
                >
                  {sheet.faixa}
                </span>
              </div>

              <div className="px-stage flex-1 min-h-[196px] flex flex-col items-center justify-center gap-3 p-4">
                <div className="animate-ds-idle">
                  <PokemonSprite
                    looktype={sheet.looktype}
                    bridgePort={bridgePort}
                    size={124}
                    shiny={sheet.shiny}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {(sheet.tipos || []).map((t) => (
                    <DsTypeBadge key={t} type={t} />
                  ))}
                </div>
              </div>

              <div className="px-box !shadow-none p-3 text-xs space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-subtle)]">
                  Treinador
                </div>
                <div className="flex items-center justify-between font-bold text-[var(--ink)]">
                  <span className="truncate">{ownerLabel}</span>
                  <span className="font-mono-num text-[11px] text-[var(--ink-accent-amber)] shrink-0">
                    P{sheet.potencia} · {sheet.qualidade.toFixed(1)}
                  </span>
                </div>
              </div>
            </div>

            {/* Right Tab Panels */}
            <div className="p-5 flex flex-col gap-3.5">
              <TabPanels className="flex-1">
                {/* Panel 1: IVs & Stats Table */}
                <TabPanel className="space-y-3.5 animate-ds-tab focus:outline-none">
                  <div className="border border-[var(--border-mid)] rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[92px_1fr_48px_64px_48px] bg-[#1b1f26] text-slate-300 font-mono-num text-[10px] font-bold uppercase">
                      <div className="px-3 py-2">Stat</div>
                      <div className="px-2 py-2 text-center">IV (0–32)</div>
                      <div className="px-1 py-2 text-center">IV</div>
                      <div className="px-1 py-2 text-center">Stat</div>
                      <div className="px-1 py-2 text-center">Rank</div>
                    </div>

                    {STAT_LABELS.map(([k, lbl], idx) => {
                      const iv = sheet.ivs[k] || 0;
                      const statVal = sheet.stats[k] || 0;
                      const pct = Math.min(100, (iv / 32) * 100);
                      const rowBg =
                        idx % 2 === 0 ? "bg-[var(--panel-bg)]" : "bg-[var(--panel-alt)]";
                      const tone = iv >= 30 ? "gold" : iv >= 22 ? "hp" : "exp";
                      return (
                        <div
                          key={k}
                          className={`grid grid-cols-[92px_1fr_48px_64px_48px] items-center border-t border-[var(--border-soft)] ${rowBg}`}
                        >
                          <div className="px-3 py-2 text-xs font-bold text-[var(--ink)]">
                            {lbl}
                          </div>
                          <div className="px-2 py-2">
                            <DsBar pct={pct} tone={tone} height={8} />
                          </div>
                          <div
                            className={`font-mono-num text-xs font-bold text-center py-2 ${
                              iv >= 30
                                ? "text-[var(--ink-accent-amber)]"
                                : iv >= 24
                                ? "text-[var(--ink-accent-green)]"
                                : "text-[var(--ink)]"
                            }`}
                          >
                            {iv}
                          </div>
                          <div className="font-mono-num text-xs font-semibold text-center py-2 text-[var(--ink-muted)]">
                            {statVal || "—"}
                          </div>
                          <div className="font-mono-num text-[11px] font-bold text-center py-2 text-[var(--ink)]">
                            {ivRankLabel(iv)}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Birth Grade & IV Summary */}
                  <div className="px-inset p-3.5 space-y-2 text-xs">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-bold text-[var(--ink-muted)]">Nota de Nascença</span>
                      <span className={`font-mono-num font-bold uppercase ${GRADE_COLORS[sheet.faixa] || "text-[var(--ink)]"}`}>
                        {sheet.nota.toFixed(2)} / 10 ({sheet.faixa})
                      </span>
                    </div>
                    <DsBar pct={Math.min(100, sheet.nota * 10)} tone="gold" height={8} />
                    <div className="flex justify-between font-medium text-[var(--ink-muted)]">
                      <span>
                        Mercado:{" "}
                        <b
                          className={
                            sheet.mercadoOk
                              ? "text-[var(--ink-accent-green)]"
                              : "text-[var(--ink-accent-rose)]"
                          }
                        >
                          {sheet.mercadoOk ? "Elegível" : "Abaixo de 3.5"}
                        </b>
                      </span>
                      <span className="font-mono-num">
                        IV Total: <b className="text-[var(--ink)]">{sheet.ivSoma}/192</b> ({sheet.ivPct.toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </TabPanel>

                {/* Panel 2: Combat Power + Hexagonal Stats / IV Radar */}
                <TabPanel className="space-y-3.5 animate-ds-tab focus:outline-none">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                    <div className="px-inset p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)] flex items-center gap-1">
                        <Swords className="w-3.5 h-3.5 text-[var(--ink-accent-rose)]" /> Poder PvP
                      </div>
                      <div className="font-mono-num text-base font-bold text-[var(--ink-accent-rose)] mt-1">
                        {sheet.pvpPower > 0 ? fmtCompact(sheet.pvpPower) : "—"}
                      </div>
                      <div className="text-[11px] text-[var(--ink-muted)]">
                        Arena Lv {sheet.pvpLevel || sheet.level}
                      </div>
                    </div>
                    <div className="px-inset p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)] flex items-center gap-1">
                        <Shield className="w-3.5 h-3.5 text-[var(--ink-accent-amber)]" /> Poder PvE
                      </div>
                      <div className="font-mono-num text-base font-bold text-[var(--ink-accent-amber)] mt-1">
                        {sheet.pvePower > 0 ? fmtCompact(sheet.pvePower) : "—"}
                      </div>
                      <div className="text-[11px] text-[var(--ink-muted)]">Nível real</div>
                    </div>
                    <div className="px-inset p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)] flex items-center gap-1">
                        <Heart className="w-3.5 h-3.5 text-[var(--ink-accent-green)]" /> HP Combate
                      </div>
                      <div className="font-mono-num text-base font-bold text-[var(--ink-accent-green)] mt-1">
                        {sheet.combatHp > 0 ? fmtCompact(sheet.combatHp) : "—"}
                      </div>
                      <div className="text-[11px] text-[var(--ink-muted)]">Stat ×12</div>
                    </div>
                    <div className="px-inset p-3">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)] flex items-center gap-1">
                        <Target className="w-3.5 h-3.5 text-[var(--ink-accent-sky)]" /> Alcance PvP
                      </div>
                      <div className="font-mono-num text-base font-bold text-[var(--ink-accent-sky)] mt-1">
                        {sheet.alcance || 1}
                      </div>
                      <div className="text-[11px] text-[var(--ink-muted)] truncate">
                        {rangeLabel(sheet.alcance || 1)}
                      </div>
                    </div>
                  </div>

                  <StatsRadar stats={sheet.stats} ivs={sheet.ivs} />
                </TabPanel>

                {/* Panel 3: Branched / Final Evolutions */}
                <TabPanel className="space-y-3 animate-ds-tab focus:outline-none">
                  <div className="space-y-2.5 text-xs">
                    <div className="font-bold text-xs text-[var(--ink)] flex items-center gap-1.5 flex-wrap">
                      <GitBranch className="w-4 h-4 text-[var(--ink-accent-indigo)]" />
                      Evoluções &amp; Projeção Final
                      {sheet.evoPrev && (
                        <span className="font-medium text-[var(--ink-muted)] ml-auto">
                          De: <b className="text-[var(--ink)]">{sheet.evoPrev.nome}</b>
                          {sheet.evoPrev.level > 0 ? ` (Lv ${sheet.evoPrev.level})` : ""}
                        </span>
                      )}
                    </div>

                    {evolutions.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {evolutions.map((evo) => (
                          <div
                            key={evo.pokeId}
                            className="px-inset p-3 flex items-center gap-3"
                          >
                            <PokemonSprite
                              looktype={evo.looktype}
                              bridgePort={bridgePort}
                              size={52}
                              shiny={sheet.shiny}
                              className="px-stage shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-bold text-sm text-[var(--ink)] truncate">
                                {evo.nome}
                              </div>
                              <div className="text-[11px] text-[var(--ink-muted)] font-medium flex items-center gap-1.5 flex-wrap mt-0.5">
                                <span className={GRADE_COLORS[evo.faixa] || "text-[var(--ink)]"}>
                                  Nota <b>{evo.nota.toFixed(2)}</b>
                                </span>
                                <span>·</span>
                                <span className="text-[var(--ink-accent-rose)] font-mono-num font-bold">
                                  PvP {fmtCompact(evo.pvpPower)}
                                </span>
                                <span>·</span>
                                <span className="text-[var(--ink-accent-sky)] font-mono-num font-bold">
                                  Alc {evo.alcance}
                                </span>
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
                            className="px-inset px-2.5 py-1.5 font-semibold text-[var(--ink)]"
                          >
                            → {st.nome} {st.level > 0 ? `(Lv ${st.level})` : ""}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="px-inset p-5 text-center text-[var(--ink-muted)] font-medium">
                        Este Pokémon já está em sua forma final ou não possui evoluções projetadas.
                      </div>
                    )}
                  </div>
                </TabPanel>
              </TabPanels>

              {/* Optional Market Listing Footer */}
              {listing && (
                <div className="rounded-xl bg-emerald-500/12 border border-emerald-600/35 p-3.5 flex items-center justify-between gap-3 text-xs">
                  <div>
                    <div className="font-semibold text-[var(--ink)]">
                      Anúncio <span className="font-mono-num">#{listing.id}</span> · Vendedor:{" "}
                      <b>{listing.vendedor || "?"}</b>
                    </div>
                    <div className="font-mono-num text-base font-bold text-[var(--ink-accent-amber)] mt-0.5">
                      {fmtCompact(listing.preco)} {listing.moeda === "orb" ? "Gemas" : "Gold"}
                    </div>
                  </div>
                  {onBuy && (
                    <button
                      disabled={buying}
                      onClick={onBuy}
                      className="ds-btn ds-btn-green"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                      {buying ? "Comprando..." : "Comprar Agora"}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </TabGroup>
      </div>
    </DsDialog>
  );
}

function StatsRadar({
  stats,
  ivs,
}: {
  stats: Record<string, number>;
  ivs: Record<string, number>;
}) {
  const statsAvailable = hasAnyStats(stats);
  const [mode, setMode] = useState<"stats" | "ivs">(statsAvailable ? "stats" : "ivs");
  const activeMode = mode === "stats" && statsAvailable ? "stats" : "ivs";

  const cx = 140;
  const cy = 112;
  const r = 72;

  const statValues = STAT_LABELS.map(([k]) => stats[k] || 0);
  const maxStat = Math.max(...statValues, 1);
  const minStat = Math.min(...statValues);
  // Amplify visual contrast slightly when stats are close in value while preserving exact proportions
  const statFloor = maxStat > minStat ? Math.max(0, minStat * 0.45) : 0;
  const statSpan = Math.max(1, maxStat - statFloor);

  const rings = [0.25, 0.5, 0.75, 1];
  const ringPolys = rings.map((scale) =>
    STAT_LABELS.map((_, i) => {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
      return `${cx + Math.cos(angle) * r * scale},${cy + Math.sin(angle) * r * scale}`;
    }).join(" ")
  );

  const pts = STAT_LABELS.map(([k, , shortLabel], i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 6;
    const rawVal = activeMode === "stats" ? stats[k] || 0 : ivs[k] || 0;
    const ratio =
      activeMode === "stats"
        ? Math.min(1, Math.max(0.14, (rawVal - statFloor) / statSpan))
        : Math.min(1, Math.max(0.08, rawVal / 32));
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      key: k,
      x: cx + cos * r * ratio,
      y: cy + sin * r * ratio,
      gx: cx + cos * r,
      gy: cy + sin * r,
      lx: cx + cos * (r + 27),
      ly: cy + sin * (r + 22),
      label: shortLabel,
      valueText: activeMode === "stats" ? String(rawVal) : `${rawVal}/32`,
    };
  });

  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const fillCol = activeMode === "stats" ? "rgba(37, 99, 235, 0.24)" : "rgba(224, 67, 56, 0.26)";
  const strokeCol = activeMode === "stats" ? "#2563eb" : "#cf3026";

  return (
    <div className="px-inset p-3.5 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
          {activeMode === "stats" ? "Distribuição de Atributos (Stats)" : "Distribuição de IVs (0–32)"}
        </div>
        <div className="inline-flex rounded-lg bg-[var(--panel-deep)] p-0.5 border border-[var(--border-mid)] text-[11px]">
          <button
            type="button"
            disabled={!statsAvailable}
            onClick={() => setMode("stats")}
            className={`px-2.5 py-1 rounded-md font-bold transition cursor-pointer disabled:opacity-40 ${
              activeMode === "stats"
                ? "bg-[#2563eb] text-white shadow-sm"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            Stats
          </button>
          <button
            type="button"
            onClick={() => setMode("ivs")}
            className={`px-2.5 py-1 rounded-md font-bold transition cursor-pointer ${
              activeMode === "ivs"
                ? "bg-[var(--dex-red)] text-white shadow-sm"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            IVs (0–32)
          </button>
        </div>
      </div>

      <svg viewBox="0 0 280 226" className="w-full max-w-[300px] h-auto mx-auto block">
        {ringPolys.map((rp, idx) => (
          <polygon
            key={idx}
            points={rp}
            fill={idx === rings.length - 1 ? "var(--panel-bg)" : "none"}
            stroke={idx === rings.length - 1 ? "var(--border-dark)" : "var(--border-mid)"}
            strokeWidth={idx === rings.length - 1 ? "1.5" : "0.9"}
            strokeDasharray={idx === rings.length - 1 ? undefined : "2 2"}
          />
        ))}
        {pts.map((p) => (
          <line
            key={p.key}
            x1={cx}
            y1={cy}
            x2={p.gx}
            y2={p.gy}
            stroke="var(--border-mid)"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        ))}
        <polygon
          points={poly}
          fill={fillCol}
          stroke={strokeCol}
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
        {pts.map((p) => (
          <circle
            key={`dot-${p.key}`}
            cx={p.x}
            cy={p.y}
            r="3.2"
            fill={strokeCol}
            stroke="var(--panel-bg)"
            strokeWidth="1.2"
          />
        ))}
        {pts.map((p) => (
          <g key={`lbl-${p.key}`}>
            <text
              x={p.lx}
              y={p.ly - 5}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="10"
              fontWeight="800"
              fill="var(--ink)"
            >
              {p.label}
            </text>
            <text
              x={p.lx}
              y={p.ly + 8}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="10"
              fontWeight="700"
              fontFamily="JetBrains Mono, monospace"
              fill={strokeCol}
            >
              {p.valueText}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
