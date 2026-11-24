import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import { X, Swords, Shield, Heart, Target, GitBranch, ShoppingCart } from "lucide-react";
import { ListingDetail, PokemonDetail, fmtCompact } from "../lib/types";
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

const GRADE_PILL_BG: Record<string, string> = {
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

const STAT_LABELS: [string, string][] = [
  ["hp", "HP"],
  ["atk", "Attack"],
  ["def", "Defense"],
  ["spAtk", "Sp. Atk"],
  ["spDef", "Sp. Def"],
  ["speed", "Speed"],
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
  const gradeBg = GRADE_PILL_BG[sheet.faixa] || "bg-slate-600";

  return (
    <DsDialog open onClose={onClose} maxWidthClass="max-w-3xl">
      <div className="px-box overflow-hidden shadow-2xl">
        <TabGroup>
          {/* Pokédex Red Edition Top Bezel + Clean Tabs */}
          <div className="bg-gradient-to-b from-[#e04338] to-[#c72d23] border-b-[1.5px] border-[#1b1f26] px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
            <div className="ds-ribbon-pill text-white">
              <MiniBall />
              <span>Ficha Pokédex · {sheet.apelido || sheet.nome}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <TabList className="flex items-center gap-1.5">
                <Tab className="skills-tab focus:outline-none">IVs &amp; Stats</Tab>
                <Tab className="skills-tab focus:outline-none">Combate</Tab>
                <Tab className="skills-tab focus:outline-none">Evoluções</Tab>
              </TabList>
              <button
                onClick={onClose}
                title="Fechar ficha"
                className="ml-1 ds-btn ds-btn-slate ds-btn-sm !px-2"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 2-Column Body */}
          <div className="grid grid-cols-1 md:grid-cols-[236px_1fr] bg-[var(--panel-bg)]">
            {/* Left Sprite Stage */}
            <div className="border-b md:border-b-0 md:border-r border-[var(--border-mid)] p-4 flex flex-col gap-3 bg-[var(--panel-alt)]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono-num text-xs font-bold bg-[#1b1f26] text-[#fde047] px-2 py-0.5 rounded">
                  Lv.{sheet.level}
                </span>
                <span
                  className={`font-mono-num text-[10px] font-bold uppercase px-2 py-0.5 rounded text-white ${gradeBg}`}
                >
                  {sheet.faixa}
                </span>
              </div>

              <div className="px-stage flex-1 min-h-[164px] flex flex-col items-center justify-center gap-3 p-4">
                <div className="animate-ds-idle">
                  <PokemonSprite
                    looktype={sheet.looktype}
                    bridgePort={bridgePort}
                    size={92}
                    shiny={sheet.shiny}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {(sheet.tipos || []).map((t) => (
                    <DsTypeBadge key={t} type={t} />
                  ))}
                </div>
              </div>

              <div className="px-box !shadow-none p-2.5 text-xs space-y-1">
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
            <div className="p-4 flex flex-col gap-3">
              <TabPanels className="flex-1">
                {/* Panel 1: IVs & Stats Table */}
                <TabPanel className="space-y-3 animate-ds-tab focus:outline-none">
                  <div className="border border-[var(--border-mid)] rounded-lg overflow-hidden">
                    <div className="grid grid-cols-[88px_1fr_44px_56px_46px] bg-[#1b1f26] text-slate-300 font-mono-num text-[10px] font-bold uppercase">
                      <div className="px-3 py-2">Stat</div>
                      <div className="px-2 py-2 text-center">IV (0–32)</div>
                      <div className="px-1 py-2 text-center">IV</div>
                      <div className="px-1 py-2 text-center">Base</div>
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
                          className={`grid grid-cols-[88px_1fr_44px_56px_46px] items-center border-t border-[var(--border-soft)] ${rowBg}`}
                        >
                          <div className="px-3 py-2 text-xs font-bold text-[var(--ink)]">
                            {lbl}
                          </div>
                          <div className="px-2 py-2">
                            <DsBar pct={pct} tone={tone} height={7} />
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
                          <div className="font-mono-num text-xs text-center py-2 text-[var(--ink-muted)]">
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
                  <div className="px-inset p-3 space-y-2 text-xs">
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

                {/* Panel 2: Combat Power + Hexagonal IV Radar */}
                <TabPanel className="space-y-3 animate-ds-tab focus:outline-none">
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
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

                  <div className="px-inset p-2.5 flex items-center justify-center">
                    <IVRadar ivs={sheet.ivs} />
                  </div>
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {evolutions.map((evo) => (
                          <div
                            key={evo.pokeId}
                            className="px-inset p-2.5 flex items-center gap-2.5"
                          >
                            <PokemonSprite
                              looktype={evo.looktype}
                              bridgePort={bridgePort}
                              size={40}
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
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-600/35 p-3 flex items-center justify-between gap-3 text-xs">
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
      label: ["HP", "ATK", "DEF", "SpA", "SpD", "SPD"][i],
    };
  });
  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const outer = pts.map((p) => `${p.gx},${p.gy}`).join(" ");
  return (
    <svg viewBox="0 0 160 160" className="w-40 h-40 mx-auto">
      <polygon points={outer} fill="var(--panel-bg)" stroke="var(--border-dark)" strokeWidth="1.5" />
      {pts.map((p, i) => (
        <line key={i} x1={cx} y1={cy} x2={p.gx} y2={p.gy} stroke="var(--border-mid)" strokeWidth="1" strokeDasharray="2 2" />
      ))}
      <polygon
        points={poly}
        fill="rgba(224, 67, 56, 0.28)"
        stroke="#cf3026"
        strokeWidth="2.2"
      />
      {pts.map((p, i) => (
        <text
          key={i}
          x={p.lx}
          y={p.ly}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="9"
          fontWeight="700"
          fill="var(--ink)"
        >
          {p.label}
        </text>
      ))}
    </svg>
  );
}
