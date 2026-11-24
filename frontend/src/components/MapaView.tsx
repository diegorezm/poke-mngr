import { useEffect, useMemo, useState } from "react";
import { Lock, Search, Play, Clock, X, Shield, Flame } from "lucide-react";
import { AccountTelemetry, HuntInfo, HuntsCatalog, fmtCompact } from "../lib/types";
import { api } from "../lib/api";
import {
  REGION_ORDER,
  TYPES,
  TYPE_COLOR,
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

  const calcBySlug = useMemo(() => {
    const map = new Map<string, { xpH: number; ouroH: number; rank: number | null; umHit: boolean }>();
    const ranked = rankLines(advisor.data?.lines, order);
    const rankPos = new Map(ranked.map((l, i) => [l.slug, i + 1]));
    for (const l of advisor.data?.lines || []) {
      map.set(l.slug, {
        xpH: l.xpPokemonH,
        ouroH: l.ouroH,
        rank: rankPos.get(l.slug) ?? null,
        umHit: l.umHit,
      });
    }
    return map;
  }, [advisor.data, order]);

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

  const availableRegions = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const h of catalog?.hunts || []) {
      counts[h.regiao] = (counts[h.regiao] || 0) + 1;
    }
    return REGION_ORDER.filter((r) => counts[r.id] > 0).map((r) => ({
      ...r,
      count: counts[r.id],
    }));
  }, [catalog]);

  useEffect(() => {
    if (availableRegions.length > 0 && !availableRegions.some((r) => r.id === region)) {
      setRegion(availableRegions[0].id);
    }
  }, [availableRegions]);

  const filteredHunts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog?.hunts || []).filter((h) => {
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
  }, [catalog, region, query, typeFilter, typeMode]);

  const inspected: HuntInfo | undefined = useMemo(() => {
    const slug = inspectSlug || catalog?.activeSlug || filteredHunts[0]?.slug;
    return (catalog?.hunts || []).find((h) => h.slug === slug);
  }, [catalog, inspectSlug, filteredHunts]);

  const handleSelectHunt = async (h: HuntInfo) => {
    if (!activeAccId) return;
    try {
      await api.selectHunt(activeAccId, h.slug);
      onToast(
        catalog && catalog.combatLockMs > 0
          ? `${activeAcc?.nick}: ${h.nome} enfileirada após trava de combate`
          : `${activeAcc?.nick}: indo caçar em ${h.nome}`
      );
      refresh();
    } catch (e) {
      onToast(`Erro ao trocar hunt: ${String(e)}`);
    }
  };

  const handleTier = async (tier: number) => {
    if (!activeAccId) return;
    try {
      await api.selectOutlandTier(activeAccId, tier);
      onToast(`${activeAcc?.nick}: Outland Tier ${tier} selecionado`);
      refresh();
    } catch (e) {
      onToast(`Erro no tier: ${String(e)}`);
    }
  };

  if (accounts.length === 0) {
    return (
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-10 text-center text-sm text-slate-400 max-w-lg mx-auto mt-10">
        Adicione uma conta para explorar o Mapa e trocar hunts remotamente.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Bar: Account Selector + Filters */}
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">Conta:</span>
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedAccId(a.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                activeAccId === a.id
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-[#0b0e1b] text-slate-300 border-slate-800 hover:border-slate-700"
              }`}
            >
              {a.nick} <span className="text-slate-500 font-mono">Lv {a.level}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar hunt ou Pokémon..."
              className="pl-8 pr-3 py-1.5 rounded-lg bg-[#0b0e1b] border border-slate-700 text-white w-52"
            />
          </div>
          <select
            value={typeMode}
            onChange={(e) => setTypeMode(e.target.value as "has" | "weak" | "resist")}
            className="rounded-lg bg-[#0b0e1b] border border-slate-700 px-2 py-1.5 text-slate-200"
          >
            <option value="has">Do tipo</option>
            <option value="weak">Fraco contra</option>
            <option value="resist">Forte contra</option>
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-lg bg-[#0b0e1b] border border-slate-700 px-2 py-1.5 text-slate-200"
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

      {/* Best Hunt Advisor Card (XP/h or Ouro/h via PokéIdle Hub) */}
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
          onFocus={(slug) => {
            setInspectSlug(slug);
            const target = (catalog?.hunts || []).find((h) => h.slug === slug);
            if (target) setRegion(target.regiao);
          }}
          onHunt={handleSelectHunt}
        />
      )}

      {/* Pending Hunt Queue Banner */}
      {catalog?.pendingSlug && (
        <div className="rounded-xl bg-amber-500/15 border border-amber-500/35 px-4 py-2.5 flex items-center justify-between text-xs text-amber-200">
          <span className="inline-flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            Troca agendada para <b>{catalog.pendingSlug}</b> assim que a trava de combate terminar
            {catalog.combatLockMs > 0 ? ` (~${Math.ceil(catalog.combatLockMs / 1000)}s)` : ""}.
          </span>
          <button
            onClick={() => api.cancelPendingHunt(activeAccId).then(refresh)}
            className="px-2 py-1 rounded bg-slate-900/70 hover:bg-slate-900 text-amber-300 inline-flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> Cancelar
          </button>
        </div>
      )}

      {/* Region Tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {availableRegions.map((r) => (
          <button
            key={r.id}
            onClick={() => setRegion(r.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
              region === r.id
                ? "bg-indigo-500/25 text-indigo-200 border-indigo-500/40"
                : "bg-[#111525] text-slate-400 border-slate-800 hover:text-white"
            }`}
          >
            {r.label} <span className="text-[10px] opacity-60">({r.count})</span>
          </button>
        ))}
      </div>

      {/* Outland Tiers Bar */}
      {region === "outland" && catalog && catalog.outlandTiers.length > 0 && (
        <div className="rounded-xl bg-[#111525] border border-purple-500/25 p-3 flex items-center gap-2 flex-wrap text-xs">
          <span className="text-purple-300 font-semibold mr-1">Outland Tier:</span>
          {catalog.outlandTiers.map((t) => {
            const locked = catalog.accountLevel < t.nivel;
            const selected = (catalog.outlandTier || 1) === t.tier;
            return (
              <button
                key={t.tier}
                disabled={locked}
                onClick={() => handleTier(t.tier)}
                className={`px-2.5 py-1 rounded-lg border transition inline-flex items-center gap-1 ${
                  selected
                    ? "bg-purple-500/30 text-purple-100 border-purple-400"
                    : locked
                    ? "bg-slate-900/50 text-slate-600 border-slate-800 cursor-not-allowed"
                    : "bg-[#0b0e1b] text-slate-300 border-slate-700 hover:border-purple-500/50"
                }`}
              >
                {locked && <Lock className="w-3 h-3" />}
                T{t.tier} <span className="text-[10px] opacity-75">×{t.mult}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Grid: Hunt Rows + Sticky Analyser */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 space-y-2">
          {filteredHunts.length === 0 ? (
            <div className="rounded-xl bg-[#111525] border border-slate-800 p-8 text-center text-xs text-slate-400">
              {catalog?.hunts.length === 0
                ? "Aguardando conta conectar para carregar catálogo de hunts..."
                : "Nenhuma hunt encontrada com esses filtros."}
            </div>
          ) : (
            filteredHunts.map((h) => {
              const locked = h.nivelNecessario > (catalog?.accountLevel || 0);
              const isActive = catalog?.activeSlug === h.slug;
              const isPending = catalog?.pendingSlug === h.slug;
              const isSelected = inspected?.slug === h.slug;
              const sim = calcBySlug.get(h.slug);
              return (
                <div
                  key={h.slug}
                  onClick={() => setInspectSlug(h.slug)}
                  className={`rounded-xl border p-3 flex items-center justify-between gap-3 cursor-pointer transition ${
                    isActive
                      ? "bg-emerald-500/10 border-emerald-500/40"
                      : isSelected
                      ? "bg-[#151a2e] border-indigo-500/40"
                      : "bg-[#111525] border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <PokemonSprite
                      looktype={h.mainLook}
                      bridgePort={bridgePort}
                      size={42}
                      className="rounded-lg bg-[#090c18] border border-slate-800"
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {sim?.rank && sim.rank <= 3 && (
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-400 text-slate-950">
                            #{sim.rank}
                          </span>
                        )}
                        <span className="font-semibold text-sm text-white truncate">
                          {h.nome || h.slug}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          Lv {h.nivelMin || h.nivelNecessario}
                          {h.nivelMax ? `–${h.nivelMax}` : "+"}
                        </span>
                        {sim && (
                          <span className="text-[11px] font-mono text-sky-300">
                            {fmtCompact(order === "ouro" ? sim.ouroH : sim.xpH)}{" "}
                            {order === "ouro" ? "ouro/h" : "XP/h"}
                          </span>
                        )}
                        {isActive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">
                            Caçando
                          </span>
                        )}
                        {isPending && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium">
                            Na fila
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-wrap mt-1">
                        {(h.tipos || []).slice(0, 5).map((t) => (
                          <span
                            key={t}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white"
                            style={{ backgroundColor: TYPE_COLOR[t] || "#475569" }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <button
                    disabled={locked || isActive || activeAcc?.state !== "ONLINE"}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectHunt(h);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 shrink-0 transition ${
                      locked
                        ? "bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed"
                        : isActive
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-indigo-500 hover:bg-indigo-400 text-white"
                    }`}
                  >
                    {locked ? (
                      <>
                        <Lock className="w-3.5 h-3.5" /> Lv {h.nivelNecessario}
                      </>
                    ) : isActive ? (
                      "Ativa"
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" /> Caçar
                      </>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Sticky Hunt Analyser */}
        {inspected && (
          <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-4 sticky top-0">
            <div className="flex items-center gap-3">
              <PokemonSprite
                looktype={inspected.mainLook}
                bridgePort={bridgePort}
                size={52}
                className="rounded-xl bg-[#090c18] border border-slate-800"
              />
              <div>
                <h3 className="font-semibold text-base text-white">
                  {inspected.nome || inspected.slug}
                </h3>
                <div className="text-xs text-slate-400">
                  {inspected.regiao.toUpperCase()} · Lv mín {inspected.nivelNecessario}
                </div>
              </div>
            </div>

            {/* Matchup Summary */}
            {(inspected.tipos || []).length > 0 && (() => {
              const m = matchup((inspected.tipos || []).slice(0, 2));
              return (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-1.5 text-rose-300 font-medium">
                    <Flame className="w-3.5 h-3.5" /> Fraquezas principais
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {m.weak.slice(0, 6).map((w) => (
                      <span
                        key={w.type}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                        style={{ backgroundColor: TYPE_COLOR[w.type] }}
                      >
                        {w.type} ×{w.mult}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 text-sky-300 font-medium pt-1">
                    <Shield className="w-3.5 h-3.5" /> Resistências
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {m.resist.slice(0, 6).map((r) => (
                      <span
                        key={r.type}
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white opacity-80"
                        style={{ backgroundColor: TYPE_COLOR[r.type] }}
                      >
                        {r.type} ×{r.mult}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Species list */}
            {inspected.especies && inspected.especies.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-slate-300">
                  Espécies ({inspected.especies.length})
                </div>
                <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                  {inspected.especies.map((sp, i) => (
                    <div
                      key={`${sp.pokeId}-${i}`}
                      className="rounded-lg bg-[#0b0e1b] border border-slate-800/80 px-2.5 py-1.5 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <PokemonSprite looktype={sp.looktype} bridgePort={bridgePort} size={26} />
                        <span className="text-slate-200 truncate">{sp.nome}</span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        {sp.nivelMin ? `Lv ${sp.nivelMin}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Drops */}
            {inspected.drops && inspected.drops.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-medium text-slate-300">Drops</div>
                <div className="flex flex-wrap gap-1">
                  {inspected.drops.map((d) => (
                    <span
                      key={d}
                      className="text-[11px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-200 border border-amber-500/20"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
