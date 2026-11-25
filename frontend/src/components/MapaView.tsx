import { useEffect, useState } from "react";
import { Lock, Search, Play, Clock, X, Shield, Flame, Compass, Info } from "lucide-react";
import { AccountTelemetry, HuntInfo, HuntsCatalog, fmtCompact } from "../lib/types";
import { api } from "../lib/api";
import {
  REGION_ORDER,
  TYPES,
  effectiveness,
  matchup,
} from "../lib/gameData";
import {
  HuntOrder,
  rankLines,
  useBestHunts,
} from "../lib/huntAdvisor";
import { BestHuntCard } from "./BestHuntCard";
import { PokemonSprite } from "./PokemonSprite";
import { DsDialog, DsTypeBadge, MiniBall } from "./DsPrimitives";

export function MapaView({
  accounts,
  bridgePort,
  onToast,
}: {
  accounts: AccountTelemetry[];
  bridgePort: number;
  onToast: (msg: string) => void;
}) {
  const [selectedAccId, setSelectedAccId] = useState<number>(0);
  const [catalog, setCatalog] = useState<HuntsCatalog | null>(null);
  const [region, setRegion] = useState<string>("kanto");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [typeMode, setTypeMode] = useState<"has" | "weak" | "resist">("has");
  const [inspectSlug, setInspectSlug] = useState<string | null>(null);
  const [order, setOrder] = useState<HuntOrder>("xp");

  const activeAccId = selectedAccId || accounts[0]?.id || 0;
  const activeAcc = accounts.find((a) => a.id === activeAccId);
  const advisorTrigger = activeAcc
    ? `${activeAcc.id}:${activeAcc.level}:${activeAcc.activePokemon?.id || 0}:${activeAcc.activePokemon?.level || 0}`
    : "";
  const advisor = useBestHunts(
    activeAccId,
    advisorTrigger,
    activeAcc?.state === "ONLINE"
  );

  const calcBySlug = new Map<
    string,
    { xpH: number; ouroH: number; rank: number | null; umHit: boolean }
  >();
  const rankedLines = rankLines(advisor.data?.lines, order);
  const rankPos = new Map(rankedLines.map((l, i) => [l.slug, i + 1]));
  for (const l of advisor.data?.lines || []) {
    calcBySlug.set(l.slug, {
      xpH: l.xpPokemonH,
      ouroH: l.ouroH,
      rank: rankPos.get(l.slug) ?? null,
      umHit: l.umHit,
    });
  }

  const refresh = () => {
    if (!activeAccId) return;
    api
      .getHuntsCatalog(activeAccId)
      .then((c) => {
        setCatalog({
          ...c,
          hunts: Array.isArray(c.hunts) ? c.hunts : [],
          outlandTiers: Array.isArray(c.outlandTiers) ? c.outlandTiers : [],
        });
      })
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
  }, [activeAccId, activeAcc?.hunt.slug, activeAcc?.hunt.pendingSlug, activeAcc?.hunt.outlandTier, activeAcc?.state]);

  const regionCounts: Record<string, number> = {};
  for (const h of catalog?.hunts || []) {
    const regKey = h.regiao;
    regionCounts[regKey] = (regionCounts[regKey] || 0) + 1;
  }
  const availableRegions = REGION_ORDER.filter((r) => regionCounts[r.id] > 0).map((r) => ({
    ...r,
    count: regionCounts[r.id],
  }));

  useEffect(() => {
    if (availableRegions.length > 0 && !availableRegions.some((r) => r.id === region)) {
      setRegion(availableRegions[0].id);
    }
  }, [availableRegions, region]);

  const q = query.trim().toLowerCase();
  const filteredHunts = (catalog?.hunts || []).filter((h) => {
    if (h.regiao !== region) return false;
    if (q) {
      const matchName =
        h.nome.toLowerCase().includes(q) ||
        h.slug.toLowerCase().includes(q) ||
        (h.especies || []).some((e) => e.nome.toLowerCase().includes(q));
      if (!matchName) return false;
    }
    if (typeFilter) {
      const tipos = h.tipos || [];
      if (typeMode === "has" && !tipos.includes(typeFilter)) return false;
      if (typeMode === "weak") {
        const isWeak = (h.especies || []).some((e) => effectiveness(typeFilter, e.tipos || []) > 1);
        if (!isWeak) return false;
      }
      if (typeMode === "resist") {
        const isRes = (h.especies || []).some((e) => effectiveness(typeFilter, e.tipos || []) < 1);
        if (!isRes) return false;
      }
    }
    return true;
  });

  const inspected: HuntInfo | undefined = inspectSlug
    ? (catalog?.hunts || []).find((h) => h.slug === inspectSlug)
    : undefined;
  const inspectedSim = inspected ? calcBySlug.get(inspected.slug) : undefined;
  const inspectedLocked = inspected
    ? inspected.nivelNecessario > (catalog?.accountLevel || 0)
    : false;
  const inspectedActive = inspected ? catalog?.activeSlug === inspected.slug : false;
  const inspectedMatchup =
    inspected && (inspected.tipos || []).length > 0
      ? matchup((inspected.tipos || []).slice(0, 2))
      : null;

  const handleSelectHunt = async (h: HuntInfo) => {
    if (!activeAccId) return;
    const accNick = activeAcc?.nick || "";
    const msg =
      catalog && catalog.combatLockMs > 0
        ? `${accNick}: ${h.nome} enfileirada após trava de combate`
        : `${accNick}: indo caçar em ${h.nome}`;
    const slug = h.slug;
    try {
      await api.selectHunt(activeAccId, slug);
      onToast(msg);
      refresh();
    } catch (e) {
      onToast(`Erro ao trocar hunt: ${String(e)}`);
    }
  };

  const handleTier = async (tier: number) => {
    if (!activeAccId) return;
    const nick = activeAcc?.nick || "";
    try {
      await api.selectOutlandTier(activeAccId, tier);
      onToast(`${nick}: Outland Tier ${tier} selecionado`);
      refresh();
    } catch (e) {
      onToast(`Erro no tier: ${String(e)}`);
    }
  };

  if (accounts.length === 0) {
    return (
      <div className="px-box p-10 text-center text-sm text-[var(--ink-muted)] font-medium max-w-lg mx-auto mt-10">
        Adicione uma conta para explorar o Mapa e trocar hunts remotamente.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Pokédex Bar: Account Switcher + Pending Hunt Banner */}
      <div className="px-box overflow-hidden">
        <div className="bg-gradient-to-b from-[#e04338] to-[#c72d23] px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="ds-ribbon-pill text-white text-sm">
            <MiniBall />
            <span>Pokédex · Melhores Hunts &amp; Mapa</span>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setSelectedAccId(a.id);
                  setInspectSlug(null);
                }}
                className={`text-xs font-bold px-3 py-1.5 rounded-md border transition cursor-pointer ${
                  activeAccId === a.id
                    ? "bg-white text-[#b91c1c] border-[#1b1f26] shadow-sm"
                    : "bg-black/20 text-red-50 border-white/25 hover:bg-black/30"
                }`}
              >
                {a.nick} <span className="font-mono-num opacity-75">Lv.{a.level}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Pending Hunt Queue Banner */}
        {catalog?.pendingSlug && (
          <div className="bg-amber-500/15 border-t border-amber-500/35 px-5 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold text-[var(--ink)]">
            <span className="inline-flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--ink-accent-amber)]" />
              Troca agendada para <b>{catalog.pendingSlug}</b> assim que a trava de combate terminar
              {catalog.combatLockMs > 0 ? ` (~${Math.ceil(catalog.combatLockMs / 1000)}s)` : ""}.
            </span>
            <button
              onClick={() => api.cancelPendingHunt(activeAccId).then(refresh)}
              className="ds-btn ds-btn-red ds-btn-sm"
            >
              <X className="w-3.5 h-3.5" /> Cancelar
            </button>
          </div>
        )}
      </div>

      {/* HERO SECTION (Full Width): Best Hunts Ranking */}
      {activeAcc && (
        <BestHuntCard
          nick={activeAcc.nick}
          bridgePort={bridgePort}
          order={order}
          onOrder={setOrder}
          best={advisor.data}
          loading={advisor.loading}
          error={advisor.error}
          onRetry={advisor.reload}
          online={activeAcc.state === "ONLINE"}
          hunts={catalog?.hunts || []}
          currentSlug={catalog?.activeSlug || ""}
          pendingSlug={catalog?.pendingSlug || ""}
          inspectedSlug={inspectSlug || undefined}
          onFocus={(slug) => setInspectSlug(slug)}
          onHunt={handleSelectHunt}
        />
      )}

      {/* Secondary Section (Full Width): Full Region Hunt Explorer */}
      <section className="px-box overflow-hidden">
        <div className="bg-[var(--panel-alt)] border-b border-[var(--border-mid)] px-5 py-3.5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Compass className="w-4 h-4 text-[var(--dex-red)]" />
              <h3 className="text-sm font-bold text-[var(--ink)]">
                Explorar todas as regiões
              </h3>
              <span className="text-xs text-[var(--ink-muted)] hidden sm:inline">
                · clique em qualquer hunt para abrir fraquezas, espécies e drops
              </span>
            </div>

            {/* Search & Type Filter */}
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar hunt ou espécie..."
                  className="ds-input pl-8 pr-3 py-1.5 w-52 text-xs font-medium"
                />
              </div>
              <select
                value={typeMode}
                onChange={(e) => setTypeMode(e.target.value as "has" | "weak" | "resist")}
                className="ds-input px-2.5 py-1.5 text-xs font-semibold"
              >
                <option value="has">Do tipo</option>
                <option value="weak">Fraco contra</option>
                <option value="resist">Forte contra</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="ds-input px-2.5 py-1.5 text-xs font-semibold"
              >
                <option value="">Todos os tipos</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Region Tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {availableRegions.map((r) => (
              <button
                key={r.id}
                onClick={() => setRegion(r.id)}
                className={`text-xs font-bold px-3 py-1.5 rounded-md border transition cursor-pointer ${
                  region === r.id
                    ? "bg-[var(--dex-red)] text-white border-[#1b1f26]"
                    : "bg-[var(--panel-bg)] text-[var(--ink-muted)] border-[var(--border-mid)] hover:text-[var(--ink)] hover:border-[var(--border-dark)]"
                }`}
              >
                {r.label}{" "}
                <span className="font-mono-num text-[10px] opacity-75">({r.count})</span>
              </button>
            ))}
          </div>

          {/* Outland Tiers Row */}
          {region === "outland" && catalog && catalog.outlandTiers.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-[var(--border-mid)]">
              <span className="font-mono-num text-[11px] font-bold text-[var(--ink-accent-fuchsia)] mr-1">
                OUTLAND TIER:
              </span>
              {catalog.outlandTiers.map((t) => {
                const locked = catalog.accountLevel < t.nivel;
                const selected = (catalog.outlandTier || 1) === t.tier;
                return (
                  <button
                    key={t.tier}
                    disabled={locked}
                    onClick={() => handleTier(t.tier)}
                    className={`ds-btn ds-btn-sm ${
                      selected ? "ds-btn-red" : "ds-btn-slate"
                    }`}
                  >
                    {locked && <Lock className="w-3 h-3" />}
                    T{t.tier} ×{t.mult}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Full-width Region Hunts Grid */}
        <div className="p-4">
          {filteredHunts.length === 0 ? (
            <div className="px-inset p-8 text-center text-xs text-[var(--ink-muted)] font-medium">
              {catalog?.hunts.length === 0
                ? "Aguardando conta conectar para carregar catálogo de hunts..."
                : "Nenhuma hunt encontrada com esses filtros."}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-1">
              {filteredHunts.map((h) => {
                const locked = h.nivelNecessario > (catalog?.accountLevel || 0);
                const isActive = catalog?.activeSlug === h.slug;
                const isPending = catalog?.pendingSlug === h.slug;
                const sim = calcBySlug.get(h.slug);
                return (
                  <div
                    key={h.slug}
                    onClick={() => setInspectSlug(h.slug)}
                    className={`dex-row px-3.5 py-3 flex items-center justify-between gap-3 cursor-pointer ${
                      isActive ? "dex-row-active" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <PokemonSprite
                        looktype={h.mainLook}
                        bridgePort={bridgePort}
                        size={56}
                        className="px-stage shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {sim?.rank && sim.rank <= 5 && (
                            <span className="font-mono-num text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1b1f26] text-[#fde047]">
                              #{sim.rank}
                            </span>
                          )}
                          <span className="font-bold text-sm text-[var(--ink)] truncate">
                            {h.nome || h.slug}
                          </span>
                          <span className="font-mono-num text-[11px] font-semibold text-[var(--ink-muted)]">
                            Lv {h.nivelMin || h.nivelNecessario}
                            {h.nivelMax ? `–${h.nivelMax}` : "+"}
                          </span>
                          {isActive && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-600 text-white">
                              Caçando
                            </span>
                          )}
                          {isPending && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-600 text-white">
                              Na fila
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-1">
                          {(h.tipos || []).slice(0, 3).map((t) => (
                            <DsTypeBadge key={t} type={t} />
                          ))}
                          {sim && (
                            <span className="font-mono-num text-[11px] font-bold text-[var(--ink-accent-sky)]">
                              {fmtCompact(order === "ouro" ? sim.ouroH : sim.xpH)}{" "}
                              {order === "ouro" ? "ouro/h" : "XP/h"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      disabled={locked || isActive || activeAcc?.state !== "ONLINE"}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectHunt(h);
                      }}
                      className={`ds-btn ds-btn-sm shrink-0 ${
                        locked || isActive ? "ds-btn-slate" : "ds-btn-blue"
                      }`}
                    >
                      {locked ? (
                        <>
                          <Lock className="w-3 h-3" /> Lv.{h.nivelNecessario}
                        </>
                      ) : isActive ? (
                        "Ativa"
                      ) : (
                        <>
                          <Play className="w-3 h-3" /> Caçar
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Pokédex Hunt Detail Dialog (Popup) */}
      <DsDialog
        open={Boolean(inspected)}
        onClose={() => setInspectSlug(null)}
        maxWidthClass="max-w-3xl"
      >
        {inspected && (
          <div className="px-box overflow-hidden shadow-2xl">
            {/* Crimson Pokédex Top Bezel */}
            <div className="bg-gradient-to-b from-[#e04338] to-[#c72d23] border-b-[1.5px] border-[#1b1f26] px-5 py-3 flex items-center justify-between gap-2 flex-wrap">
              <div className="ds-ribbon-pill text-white text-sm">
                <MiniBall />
                <span>{inspected.nome || inspected.slug}</span>
                <span className="font-mono-num text-[11px] bg-[#1b1f26] text-[#fde047] px-2 py-0.5 rounded ml-1">
                  Lv {inspected.nivelMin || inspected.nivelNecessario}
                  {inspected.nivelMax ? `–${inspected.nivelMax}` : "+"}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {inspectedSim?.rank && (
                  <span className="font-mono-num text-[11px] font-bold bg-[#1b1f26] text-[#fde047] px-2 py-0.5 rounded">
                    #{inspectedSim.rank} RANKING
                  </span>
                )}
                {inspectedSim?.umHit && (
                  <span className="font-mono-num text-[11px] font-bold bg-[#16a34a] text-white px-2 py-0.5 rounded">
                    1-HIT KO
                  </span>
                )}
                <button
                  onClick={() => setInspectSlug(null)}
                  title="Fechar detalhes"
                  className="ds-btn ds-btn-slate ds-btn-sm !px-2"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 2-Column Pokédex Inspector Body */}
            <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] bg-[var(--panel-bg)]">
              {/* Left Stage + Metrics + CTA */}
              <div className="border-b md:border-b-0 md:border-r border-[var(--border-mid)] p-5 flex flex-col gap-3.5 bg-[var(--panel-alt)]">
                <div className="px-stage h-44 flex flex-col items-center justify-center gap-2.5 p-3">
                  <div className="animate-ds-idle">
                    <PokemonSprite
                      looktype={inspected.mainLook}
                      bridgePort={bridgePort}
                      size={116}
                    />
                  </div>
                  {(inspected.tipos || []).length > 0 && (
                    <div className="flex flex-wrap gap-1 justify-center">
                      {(inspected.tipos || []).slice(0, 4).map((t) => (
                        <DsTypeBadge key={t} type={t} />
                      ))}
                    </div>
                  )}
                </div>

                {inspectedSim && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="px-box !shadow-none px-2.5 py-2">
                      <div className="text-[10px] font-bold uppercase text-[var(--ink-muted)]">
                        Est. XP/h
                      </div>
                      <div className="font-mono-num text-sm font-bold text-[var(--ink-accent-sky)] mt-0.5">
                        {fmtCompact(inspectedSim.xpH)}
                      </div>
                    </div>
                    <div className="px-box !shadow-none px-2.5 py-2">
                      <div className="text-[10px] font-bold uppercase text-[var(--ink-muted)]">
                        Est. Ouro/h
                      </div>
                      <div className="font-mono-num text-sm font-bold text-[var(--ink-accent-amber)] mt-0.5">
                        {fmtCompact(inspectedSim.ouroH)}
                      </div>
                    </div>
                  </div>
                )}

                <button
                  disabled={inspectedLocked || inspectedActive || activeAcc?.state !== "ONLINE"}
                  onClick={() => {
                    handleSelectHunt(inspected);
                    setInspectSlug(null);
                  }}
                  className={`w-full ds-btn mt-auto ${
                    inspectedActive || inspectedLocked ? "ds-btn-slate" : "ds-btn-red"
                  }`}
                >
                  {inspectedLocked ? (
                    <>
                      <Lock className="w-3.5 h-3.5" /> Requer Lv {inspected.nivelNecessario}
                    </>
                  ) : inspectedActive ? (
                    "Caçando aqui"
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5" /> Ir caçar aqui
                    </>
                  )}
                </button>
              </div>

              {/* Right Matchups, Species & Drops */}
              <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                {inspectedMatchup && (
                  <div className="space-y-2 text-xs">
                    <div className="font-bold text-[11px] uppercase tracking-wider text-[var(--ink-accent-rose)] flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5" /> Fraquezas
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {inspectedMatchup.weak.slice(0, 8).map((w) => (
                        <DsTypeBadge key={w.type} type={w.type} suffix={`×${w.mult}`} />
                      ))}
                    </div>
                    <div className="font-bold text-[11px] uppercase tracking-wider text-[var(--ink-accent-sky)] flex items-center gap-1.5 pt-1">
                      <Shield className="w-3.5 h-3.5" /> Resistências
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {inspectedMatchup.resist.slice(0, 8).map((r) => (
                        <DsTypeBadge key={r.type} type={r.type} suffix={`×${r.mult}`} className="opacity-85" />
                      ))}
                    </div>
                  </div>
                )}

                {inspected.especies && inspected.especies.length > 0 && (
                  <div className="space-y-2 pt-3 border-t border-[var(--border-mid)]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)] flex items-center gap-1.5">
                      <Info className="w-3.5 h-3.5" /> Espécies ({inspected.especies.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {inspected.especies.map((sp, i) => (
                        <div
                          key={`${sp.pokeId}-${i}`}
                          className="px-inset px-3 py-2 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <PokemonSprite looktype={sp.looktype} bridgePort={bridgePort} size={40} />
                            <span className="font-bold text-[var(--ink)] truncate">{sp.nome}</span>
                          </div>
                          <span className="font-mono-num text-[11px] font-semibold text-[var(--ink-muted)] shrink-0">
                            {sp.nivelMin ? `Lv.${sp.nivelMin}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {inspected.drops && inspected.drops.length > 0 && (
                  <div className="space-y-2 pt-3 border-t border-[var(--border-mid)]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                      Drops da Hunt
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {inspected.drops.map((d) => (
                        <span
                          key={d}
                          className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-500/15 text-[var(--ink-accent-amber)] border border-amber-500/30"
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DsDialog>
    </div>
  );
}
