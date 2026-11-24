import { useEffect, useState } from "react";
import {
  RefreshCw,
  Star,
  Crosshair,
  Bell,
  Trash2,
  Plus,
  ShoppingCart,
  Wallet,
  TrendingUp,
  TrendingDown,
  Calculator,
  Search,
  BarChart3,
} from "lucide-react";
import {
  AccountTelemetry,
  GlobalSettings,
  MarketLogEntry,
  MarketRule,
  fmtCompact,
} from "../lib/types";
import { api } from "../lib/api";
import { ItemSprite, PokemonSprite } from "./PokemonSprite";
import {
  InflationChart,
  InflationPoint,
  PriceSeriesChart,
  PriceSeriesPoint,
  Sparkline,
} from "./MarketCharts";

type MarketSubTab = "prices" | "vitrine" | "tape" | "stats" | "rules" | "mine";

interface ItemMetaEntry {
  id: number;
  name: string;
  icon: string;
  category?: string;
  rare?: boolean;
}

interface MoverEntry {
  name: string;
  price: number;
  changePct: number;
  sales: number;
  spark: number[];
}

function isSniperEnabled(ov: Record<string, unknown> | null): boolean {
  return Boolean(ov?.sniperEnabled);
}

function extractRows(res: Record<string, unknown>): Record<string, unknown>[] {
  return (res.linhas as Record<string, unknown>[]) || [];
}

function parseInflation(stats: Record<string, unknown> | null, moeda: "gold" | "orb"): InflationPoint[] {
  if (!stats) return [];
  const inf = stats.inflacao as Record<string, unknown> | undefined;
  const rawList = (moeda === "orb" ? inf?.itensGema : inf?.itensOuro) as
    | Record<string, unknown>[]
    | undefined;
  if (!Array.isArray(rawList)) return [];
  const out: InflationPoint[] = [];
  for (const p of rawList) {
    const day = String(p?.dia || "");
    const idx = Number(p?.indice);
    if (day && Number.isFinite(idx)) {
      out.push({ day, index: idx });
    }
  }
  return out;
}

function parseMovers(
  stats: Record<string, unknown> | null,
  moeda: "gold" | "orb",
  dir: "up" | "down"
): MoverEntry[] {
  if (!stats) return [];
  const wantMoeda = moeda === "orb" ? "gema" : "ouro";
  const tend = stats.tendencias as Record<string, unknown> | undefined;
  const raw = (
    dir === "up"
      ? tend?.sobem || stats.maioresAltas
      : tend?.caem || stats.maioresQuedas
  ) as Record<string, unknown>[] | undefined;
  if (!Array.isArray(raw)) return [];
  const out: MoverEntry[] = [];
  for (const g of raw) {
    const gMoeda = String(g?.moeda || "");
    if (gMoeda && gMoeda !== wantMoeda && gMoeda !== moeda) continue;
    const name = String(g?.nome || "").trim();
    if (!name) continue;
    const varRaw = Number(g?.variacao);
    const pct = Number.isFinite(varRaw)
      ? Math.abs(varRaw) <= 10
        ? varRaw * 100
        : varRaw
      : 0;
    const serieRaw = Array.isArray(g?.serie) ? g.serie : [];
    const spark = serieRaw.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    out.push({
      name,
      price: Number(g?.depois || g?.mediana || g?.media || 0),
      changePct: pct,
      sales: Number(g?.vendas || 0),
      spark: spark.slice(-14),
    });
  }
  return out.slice(0, 6);
}

function parseSeriesPoints(res: Record<string, unknown> | null): PriceSeriesPoint[] {
  if (!res) return [];
  const pts = (res.pontos as Record<string, unknown>[]) || [];
  if (!Array.isArray(pts)) return [];
  const out: PriceSeriesPoint[] = [];
  for (const p of pts) {
    const day = String(p?.dia || "");
    const median = Number(p?.mediana);
    if (!day || !Number.isFinite(median)) continue;
    out.push({
      day,
      median,
      p25: Number(p?.p25) || median,
      p75: Number(p?.p75) || median,
      sales: Number(p?.vendas || 0),
      units: Number(p?.unidades || 0),
    });
  }
  return out;
}

function formatRuleTitle(r: MarketRule): string {
  if (r.spec.target === "pokemon") {
    const parts: string[] = [r.spec.query?.trim() || "Qualquer Pokémon"];
    if (r.spec.onlyShiny) parts.push("Shiny");
    if (r.spec.onlyP5) parts.push("P5");
    if (r.spec.onlyZMove) parts.push("Z-Move");
    if (r.spec.onlyTmAoe) parts.push("AoE");
    if (r.spec.minIv && r.spec.minIv > 0) parts.push(`IV≥${r.spec.minIv}`);
    if (r.spec.minLevel && r.spec.minLevel > 0) parts.push(`Lv≥${r.spec.minLevel}`);
    return parts.join(" · ");
  }
  return r.spec.itemName || `Item #${r.spec.itemId}`;
}

export function MarketView({
  accounts,
  bridgePort,
  settings,
  onSettingsChange,
  onToast,
}: {
  accounts: AccountTelemetry[];
  bridgePort: number;
  settings: GlobalSettings;
  onSettingsChange: (gs: GlobalSettings) => void;
  onToast: (msg: string) => void;
}) {
  const [sub, setSub] = useState<MarketSubTab>("prices");
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [moeda, setMoeda] = useState<"gold" | "orb">("gold");
  const [buyerId, setBuyerId] = useState<number>(0);

  // Item listings modal
  const [openItem, setOpenItem] = useState<{ id: number; listings: Record<string, unknown>[] } | null>(null);

  // Vitrine
  const [vitrineQuery, setVitrineQuery] = useState("");
  const [vitrineShiny, setVitrineShiny] = useState(false);
  const [vitrineRows, setVitrineRows] = useState<Record<string, unknown>[]>([]);

  // Tape
  const [tapeMode, setTapeMode] = useState<"global" | "sales" | "buys">("global");
  const [tapeRows, setTapeRows] = useState<Record<string, unknown>[]>([]);

  // Guide Stats & Series Chart
  const [guideDays, setGuideDays] = useState(7);
  const [guideStats, setGuideStats] = useState<Record<string, unknown> | null>(null);
  const [seriesTarget, setSeriesTarget] = useState<string | null>(null);
  const [seriesPoints, setSeriesPoints] = useState<PriceSeriesPoint[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);

  // Rules & Sniper
  const [sniperEnabled, setSniperEnabled] = useState(false);
  const [rules, setRules] = useState<MarketRule[]>([]);
  const [logs, setLogs] = useState<MarketLogEntry[]>([]);
  const [newRuleKind, setNewRuleKind] = useState<"alert" | "snipe">("alert");
  const [newTarget, setNewTarget] = useState<"item" | "pokemon">("item");
  const [newItemId, setNewItemId] = useState(70000);
  const [newItemName, setNewItemName] = useState("Bronze Boss Token");
  const [newMaxPrice, setNewMaxPrice] = useState(100000);
  const [newPctBelow, setNewPctBelow] = useState(0);
  const [newBudget, setNewBudget] = useState(500000);
  const [newPokeQuery, setNewPokeQuery] = useState("");
  const [newOnlyShiny, setNewOnlyShiny] = useState(true);
  const [newOnlyP5, setNewOnlyP5] = useState(false);
  const [newOnlyZMove, setNewOnlyZMove] = useState(false);
  const [newOnlyTmAoe, setNewOnlyTmAoe] = useState(false);
  const [newMinIv, setNewMinIv] = useState(0);
  const [newMinLevel, setNewMinLevel] = useState(0);
  const [sellPctDraft, setSellPctDraft] = useState(settings.marketSellAlertPct || 30);

  // Mine & Wallet + Fee Calc
  const [myListings, setMyListings] = useState<Record<string, unknown>[]>([]);
  const [wallet, setWallet] = useState<Record<string, unknown> | null>(null);
  const [calcPrice, setCalcPrice] = useState(1000000);
  const [calcFeePct, setCalcFeePct] = useState(5);

  const onlineAccounts = accounts.filter((a) => a.state === "ONLINE");
  const activeBuyer = onlineAccounts.find((a) => a.id === buyerId) || onlineAccounts[0];

  useEffect(() => {
    setSellPctDraft(settings.marketSellAlertPct || 30);
  }, [settings.marketSellAlertPct]);

  const loadSeries = async (name: string) => {
    setSeriesTarget(name);
    setSeriesLoading(true);
    try {
      const res = await api.getMarketGuideSeries(name, moeda, guideDays);
      setSeriesPoints(parseSeriesPoints(res));
    } catch (e) {
      setSeriesPoints([]);
      onToast(`Série histórica: ${String(e)}`);
    }
    setSeriesLoading(false);
  };

  const loadOverview = async () => {
    setLoading(true);
    try {
      const ov = await api.getMarketOverview();
      setOverview(ov);
      setSniperEnabled(isSniperEnabled(ov));
    } catch (e) {
      onToast(`Mercado: ${String(e)}`);
    }
    setLoading(false);
  };

  const loadRules = async () => {
    const [r, l] = await Promise.all([
      api.listMarketRules().catch(() => []),
      api.listMarketLog().catch(() => []),
    ]);
    setRules(Array.isArray(r) ? r : []);
    setLogs(Array.isArray(l) ? l : []);
  };

  useEffect(() => {
    if (onlineAccounts.length > 0 && !overview) {
      loadOverview();
    }
    loadRules();
  }, [onlineAccounts.length]);

  useEffect(() => {
    if (sub === "vitrine" && activeBuyer) {
      api
        .getMarketVitrine(
          { moeda, busca: vitrineQuery, soShiny: vitrineShiny, pagina: 1 },
          activeBuyer.id
        )
        .then((res) => setVitrineRows((res.linhas as Record<string, unknown>[]) || []))
        .catch(() => {});
    } else if (sub === "tape" && activeBuyer) {
      api
        .getMarketTape(tapeMode, 1, activeBuyer.id)
        .then((res) => setTapeRows((res.linhas as Record<string, unknown>[]) || []))
        .catch(() => {});
    } else if (sub === "stats") {
      api
        .getMarketGuideStats(guideDays)
        .then(setGuideStats)
        .catch((e) => onToast(`Stats: ${String(e)}`));
    } else if (sub === "mine" && activeBuyer) {
      api
        .getMarketMyListings(activeBuyer.id)
        .then((res) => setMyListings((res.linhas as Record<string, unknown>[]) || []))
        .catch(() => {});
      api
        .getMarketWallet(activeBuyer.id)
        .then(setWallet)
        .catch(() => {});
    }
  }, [sub, moeda, tapeMode, guideDays, activeBuyer?.id]);

  const itemsMeta = (overview?.itemsMeta as Record<string, ItemMetaEntry>) || {};

  const resumo = (overview?.resumo as Record<string, Record<string, number>>) || {};
  const medias = (overview?.medias as Record<string, Record<string, { media?: number }>>) || {};
  const favs = new Set<number>((overview?.favs as number[]) || []);
  const q = search.trim().toLowerCase();

  const itemRows = Object.entries(resumo)
    .map(([idStr, r]) => {
      const id = Number(idStr);
      const min = moeda === "orb" ? r.minOrb || 0 : r.minGold || 0;
      const avg = medias[idStr]?.[moeda]?.media || 0;
      const pctDiff = avg > 0 && min > 0 ? ((min - avg) / avg) * 100 : 0;
      const meta = itemsMeta[idStr];
      const name = meta?.name || `Item #${id}`;
      const icon = meta?.icon || "";
      return {
        id,
        name,
        icon,
        rare: Boolean(meta?.rare),
        ads: r.anuncios || 0,
        units: r.unidades || 0,
        min,
        avg,
        pctDiff,
        fav: favs.has(id),
      };
    })
    .filter((row) => {
      if (row.min <= 0) return false;
      if (q && !row.name.toLowerCase().includes(q) && !String(row.id).includes(q)) return false;
      return true;
    })
    .sort((a, b) => Number(b.fav) - Number(a.fav) || b.units - a.units);

  const handleOpenItem = async (itemId: number) => {
    if (!activeBuyer) return;
    try {
      const res = await api.getMarketItemListings(itemId, moeda, activeBuyer.id);
      setOpenItem({ id: itemId, listings: extractRows(res) });
    } catch (e) {
      onToast(`Erro: ${String(e)}`);
    }
  };

  const handleBuy = async (ad: Record<string, unknown>) => {
    if (!activeBuyer) return;
    const id = Number(ad.id || 0);
    const qty = Number(ad.qtd || 1);
    const price = Number(ad.preco || 0);
    if (!confirm(`Comprar anúncio #${id} (${qty}x por ${fmtCompact(price)} ${moeda}) usando ${activeBuyer.nick}?`)) {
      return;
    }
    try {
      const res = await api.buyMarketListing(activeBuyer.id, id, qty, price, moeda);
      onToast(`Mercado: ${res.status} — ${res.detail}`);
      loadRules();
    } catch (e) {
      onToast(`Falha na compra: ${String(e)}`);
    }
  };

  const handleAddRule = async () => {
    const spec =
      newTarget === "pokemon"
        ? {
            target: "pokemon" as const,
            query: newPokeQuery.trim(),
            moeda,
            maxPrice: newMaxPrice,
            onlyShiny: newOnlyShiny,
            onlyP5: newOnlyP5,
            onlyZMove: newOnlyZMove,
            onlyTmAoe: newOnlyTmAoe,
            minIv: newMinIv,
            minLevel: newMinLevel,
            dailyBudget: newRuleKind === "snipe" ? newBudget : 0,
            accountIds: activeBuyer ? [activeBuyer.id] : [],
          }
        : {
            target: "item" as const,
            itemId: newItemId,
            itemName: newItemName || `Item #${newItemId}`,
            moeda,
            maxPrice: newMaxPrice,
            maxPctBelow: newPctBelow,
            dailyBudget: newRuleKind === "snipe" ? newBudget : 0,
            accountIds: activeBuyer ? [activeBuyer.id] : [],
          };
    const rule: MarketRule = {
      id: 0,
      kind: newRuleKind,
      enabled: true,
      spec,
      spent: 0,
      spentDay: "",
      lastFire: 0,
      createdAt: 0,
    };
    try {
      await api.saveMarketRule(rule);
      onToast("Regra criada!");
      loadRules();
    } catch (e) {
      onToast(`Erro: ${String(e)}`);
    }
  };

  const handleToggleSellAlert = async (enabled: boolean, pct: number) => {
    const safePct = Math.max(5, Math.min(500, pct || 30));
    const nextSettings: GlobalSettings = {
      ...settings,
      marketSellAlert: enabled,
      marketSellAlertPct: safePct,
    };
    const msg = enabled
      ? `Alerta de venda acima da média ligado (+${safePct}%)`
      : "Alerta de venda acima da média desligado";
    try {
      await api.setMarketSellAlert(enabled, safePct);
      onSettingsChange(nextSettings);
      onToast(msg);
    } catch (e) {
      onToast(`Erro: ${String(e)}`);
    }
  };

  const handleToggleSniper = async () => {
    const next = !sniperEnabled;
    await api.setSniperEnabled(next);
    setSniperEnabled(next);
    onToast(next ? "Sniper LIGADO (com orçamento diário)" : "Sniper DESLIGADO");
  };

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap text-xs">
          {(
            [
              ["prices", "Preços"],
              ["vitrine", "Vitrine Pokémon"],
              ["tape", "Histórico"],
              ["stats", "Estatísticas"],
              ["rules", `Alertas & Sniper (${rules.length})`],
              ["mine", "Carteira & Calc"],
            ] as [MarketSubTab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setSub(id)}
              className={`px-3 py-1.5 rounded-xl font-medium border transition ${
                sub === id
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-[#0b0e1b] text-slate-400 border-slate-800 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-xs">
          <select
            value={moeda}
            onChange={(e) => setMoeda(e.target.value as "gold" | "orb")}
            className="rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-1.5 text-white"
          >
            <option value="gold">Ouro (Gold)</option>
            <option value="orb">Gemas (Orbs)</option>
          </select>
          <select
            value={activeBuyer?.id || 0}
            onChange={(e) => setBuyerId(Number(e.target.value))}
            className="rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-1.5 text-slate-200"
          >
            {onlineAccounts.length === 0 ? (
              <option value={0}>Sem conta online</option>
            ) : (
              onlineAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  Conta: {a.nick}
                </option>
              ))
            )}
          </select>
          <button
            disabled={loading}
            onClick={loadOverview}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
            title="Atualizar mercado"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Prices Tab */}
      {sub === "prices" && (
        <div className="space-y-3">
          <div className="relative max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar item ou ID..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#111525] border border-slate-700 text-xs text-white"
            />
          </div>

          <div className="rounded-2xl bg-[#111525] border border-slate-800 overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-[#0d101d] text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-3 py-2.5">Item</th>
                  <th className="px-3 py-2.5">Menor Preço</th>
                  <th className="px-3 py-2.5">Média 7d</th>
                  <th className="px-3 py-2.5">Anúncios</th>
                  <th className="px-3 py-2.5 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {itemRows.slice(0, 80).map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30">
                    <td className="px-3 py-2 flex items-center gap-2.5">
                      <button
                        onClick={() => api.toggleMarketFav(row.id).then(loadOverview)}
                        className={row.fav ? "text-amber-400" : "text-slate-600 hover:text-slate-400"}
                      >
                        <Star className="w-3.5 h-3.5" />
                      </button>
                      <ItemSprite icon={row.icon} size={26} alt={row.name} />
                      <span className="font-medium text-white">{row.name}</span>
                      <span className="text-[10px] text-slate-500 font-mono">#{row.id}</span>
                      {row.pctDiff <= -10 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold">
                          Barato {row.pctDiff.toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-amber-300 font-semibold">
                      {fmtCompact(row.min)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-400">
                      {row.avg > 0 ? fmtCompact(row.avg) : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-slate-300">
                      {row.ads} ({fmtCompact(row.units)} un)
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        onClick={() => handleOpenItem(row.id)}
                        className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 border border-indigo-500/30"
                      >
                        Ver anúncios
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Vitrine Tab */}
      {sub === "vitrine" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <input
              value={vitrineQuery}
              onChange={(e) => setVitrineQuery(e.target.value)}
              placeholder="Buscar Pokémon..."
              className="rounded-lg bg-[#111525] border border-slate-700 px-3 py-1.5 text-white"
            />
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#111525] border border-slate-800">
              <input
                type="checkbox"
                checked={vitrineShiny}
                onChange={(e) => setVitrineShiny(e.target.checked)}
              />
              Só Shiny
            </label>
            <button
              onClick={() =>
                activeBuyer &&
                api
                  .getMarketVitrine(
                    { moeda, busca: vitrineQuery, soShiny: vitrineShiny, pagina: 1 },
                    activeBuyer.id
                  )
                  .then((res) => setVitrineRows((res.linhas as Record<string, unknown>[]) || []))
              }
              className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white font-semibold"
            >
              Pesquisar
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {vitrineRows.map((ad, idx) => {
              const pk = (ad.pokemon as Record<string, unknown>) || ad;
              const look = Number(
                (pk.shiny && pk.lookShiny ? pk.lookShiny : pk.looktype) || ad.looktype || 0
              );
              return (
                <div
                  key={String(ad.id || idx)}
                  className="rounded-xl bg-[#111525] border border-slate-800 p-3 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <PokemonSprite
                      looktype={look}
                      bridgePort={bridgePort}
                      size={44}
                      shiny={Boolean(pk.shiny || ad.shiny)}
                      className="rounded-lg bg-[#090c18] border border-slate-800"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">
                        {String(ad.nome || pk.nome || pk.especie || "Pokémon")}{" "}
                        {pk.shiny || ad.shiny ? "✨" : ""}
                      </div>
                      <div className="text-slate-400 truncate">
                        Lv {Number(pk.level || ad.level || 0)} · {String(ad.vendedor || "?")}
                      </div>
                      <div className="font-mono text-amber-300 font-bold mt-0.5">
                        {fmtCompact(Number(ad.preco || 0))} {moeda}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleBuy(ad)}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30 inline-flex items-center gap-1 shrink-0"
                  >
                    <ShoppingCart className="w-3.5 h-3.5" /> Comprar
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tape Tab */}
      {sub === "tape" && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs">
            {(
              [
                ["global", "Vendas Globais"],
                ["sales", "Minhas Vendas"],
                ["buys", "Minhas Compras"],
              ] as const
            ).map(([m, lbl]) => (
              <button
                key={m}
                onClick={() => setTapeMode(m)}
                className={`px-3 py-1.5 rounded-lg border ${
                  tapeMode === m
                    ? "bg-indigo-500/25 text-indigo-200 border-indigo-500/40"
                    : "bg-[#111525] text-slate-400 border-slate-800"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          <div className="rounded-2xl bg-[#111525] border border-slate-800 divide-y divide-slate-800/70 text-xs">
            {tapeRows.length === 0 ? (
              <div className="p-6 text-center text-slate-500">Sem registros recentes.</div>
            ) : (
              tapeRows.map((row, idx) => (
                <div key={idx} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="text-white">
                    <b>{String(row.nome || row.descricao || "Item")}</b>{" "}
                    <span className="text-slate-400">×{Number(row.qtd || 1)}</span>
                  </div>
                  <div className="font-mono text-amber-300">
                    {fmtCompact(Number(row.preco || row.total || 0))}{" "}
                    {String(row.moeda || "gold")}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Stats Tab (pokeidleguide.io — Inflation, Movers & Series SVG Charts) */}
      {sub === "stats" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-300">Analytics da comunidade (pokeidleguide.io):</span>
              {[7, 15, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setGuideDays(d)}
                  className={`px-2.5 py-1 rounded-lg border ${
                    guideDays === d
                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                      : "bg-[#111525] text-slate-400 border-slate-800"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-500">
              Clique em qualquer item para abrir o gráfico de histórico de preços
            </span>
          </div>

          {!guideStats ? (
            <div className="rounded-2xl bg-[#111525] border border-slate-800 p-6 text-xs text-slate-400">
              Carregando dados do pokeidleguide.io...
            </div>
          ) : (
            <div className="space-y-4">
              {/* Interactive Item Price Series Chart */}
              {seriesTarget && (
                <PriceSeriesChart
                  title={seriesTarget}
                  moedaLabel={moeda === "orb" ? "Gemas" : "Gold"}
                  points={seriesPoints}
                  loading={seriesLoading}
                  onClose={() => setSeriesTarget(null)}
                />
              )}

              {/* Inflation Line/Area Chart */}
              <InflationChart
                points={parseInflation(guideStats, moeda)}
                moedaLabel={moeda === "orb" ? "Gemas" : "Gold"}
              />

              {/* Top Movers: Maiores Altas & Maiores Quedas with SVG Sparklines */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-2.5">
                  <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4" /> Maiores Altas ({guideDays}d)
                  </div>
                  {parseMovers(guideStats, moeda, "up").length === 0 ? (
                    <div className="text-slate-500 py-2">Sem altas registradas nesta moeda.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {parseMovers(guideStats, moeda, "up").map((m) => (
                        <button
                          key={m.name}
                          onClick={() => loadSeries(m.name)}
                          className="w-full rounded-xl bg-[#0b0e1b] border border-slate-800 hover:border-emerald-500/40 px-3 py-2 flex items-center justify-between gap-2 text-left transition"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-white truncate">{m.name}</div>
                            <div className="text-[11px] font-mono text-slate-400">
                              {fmtCompact(m.price)} · {m.sales} vendas
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Sparkline values={m.spark} positive />
                            <span className="font-mono font-bold text-emerald-300 w-14 text-right">
                              +{m.changePct.toFixed(1)}%
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-2.5">
                  <div className="font-semibold text-rose-300 flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4" /> Maiores Quedas ({guideDays}d)
                  </div>
                  {parseMovers(guideStats, moeda, "down").length === 0 ? (
                    <div className="text-slate-500 py-2">Sem quedas registradas nesta moeda.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {parseMovers(guideStats, moeda, "down").map((m) => (
                        <button
                          key={m.name}
                          onClick={() => loadSeries(m.name)}
                          className="w-full rounded-xl bg-[#0b0e1b] border border-slate-800 hover:border-rose-500/40 px-3 py-2 flex items-center justify-between gap-2 text-left transition"
                        >
                          <div className="min-w-0">
                            <div className="font-medium text-white truncate">{m.name}</div>
                            <div className="text-[11px] font-mono text-slate-400">
                              {fmtCompact(m.price)} · {m.sales} vendas
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Sparkline values={m.spark} positive={false} />
                            <span className="font-mono font-bold text-rose-300 w-14 text-right">
                              {m.changePct.toFixed(1)}%
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Most Sold Items (clickable to open price history chart) */}
              <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3 text-xs">
                <div className="font-semibold text-white flex items-center gap-1.5">
                  <BarChart3 className="w-4 h-4 text-amber-400" /> Mais Vendidos ({guideDays}d)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {((guideStats.maisVendidos as Record<string, unknown>[]) || [])
                    .filter((mv) => {
                      const wantM = moeda === "orb" ? "gema" : "ouro";
                      const mvM = String(mv?.moeda || "");
                      return !mvM || mvM === wantM || mvM === moeda;
                    })
                    .slice(0, 16)
                    .map((mv, i) => {
                      const nm = String(mv.nome || "?");
                      return (
                        <button
                          key={`${nm}-${i}`}
                          onClick={() => loadSeries(nm)}
                          className="rounded-xl bg-[#0b0e1b] border border-slate-800 hover:border-indigo-500/40 px-3 py-2 flex justify-between items-center text-left transition"
                        >
                          <span className="text-white font-medium truncate pr-2">{nm}</span>
                          <span className="font-mono text-amber-300 shrink-0">
                            {fmtCompact(Number(mv.mediana || mv.media || 0))} ·{" "}
                            {Number(mv.vendas || 0)} vendas
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rules & Sniper Tab */}
      {sub === "rules" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <Crosshair className="w-4 h-4 text-rose-400" /> Sniper Multi-Conta
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Dispara em <code>compravelEm + 20ms</code>, respeita orçamento diário e nunca compra das próprias contas.
                </p>
              </div>
              <button
                onClick={handleToggleSniper}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition shrink-0 ${
                  sniperEnabled
                    ? "bg-emerald-500 text-slate-950"
                    : "bg-slate-800 text-slate-300 border border-slate-700"
                }`}
              >
                {sniperEnabled ? "SNIPER: ON" : "SNIPER: OFF"}
              </button>
            </div>

            <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 flex items-center justify-between gap-3 text-xs">
              <div>
                <div className="text-sm font-semibold text-white flex items-center gap-2">
                  <Bell className="w-4 h-4 text-amber-400" /> Alerta de Venda (Item Raro)
                </div>
                <p className="text-slate-400 mt-0.5">
                  Avisa no Discord quando um item raro do seu inventário estiver caro acima da média 7d.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-1">
                  <span className="text-slate-400">+</span>
                  <input
                    type="number"
                    min={5}
                    max={500}
                    value={sellPctDraft}
                    onChange={(e) => setSellPctDraft(Number(e.target.value))}
                    onBlur={() =>
                      settings.marketSellAlert &&
                      handleToggleSellAlert(true, sellPctDraft)
                    }
                    className="w-16 rounded-lg bg-[#0b0e1b] border border-slate-700 px-2 py-1.5 text-amber-300 font-mono text-center"
                  />
                  <span className="text-slate-400">%</span>
                </div>
                <button
                  onClick={() =>
                    handleToggleSellAlert(!settings.marketSellAlert, sellPctDraft)
                  }
                  className={`px-3 py-2 rounded-xl font-bold transition ${
                    settings.marketSellAlert
                      ? "bg-amber-500 text-slate-950"
                      : "bg-slate-800 text-slate-300 border border-slate-700"
                  }`}
                >
                  {settings.marketSellAlert ? "ON" : "OFF"}
                </button>
              </div>
            </div>
          </div>

          {/* Add Rule Form (Item or Pokémon + % below avg) */}
          <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setNewTarget("item")}
                  className={`px-3 py-1 rounded-lg border font-medium ${
                    newTarget === "item"
                      ? "bg-indigo-500/25 text-indigo-200 border-indigo-500/40"
                      : "bg-[#0b0e1b] text-slate-400 border-slate-800"
                  }`}
                >
                  Regra de Item
                </button>
                <button
                  onClick={() => setNewTarget("pokemon")}
                  className={`px-3 py-1 rounded-lg border font-medium ${
                    newTarget === "pokemon"
                      ? "bg-indigo-500/25 text-indigo-200 border-indigo-500/40"
                      : "bg-[#0b0e1b] text-slate-400 border-slate-800"
                  }`}
                >
                  Regra de Pokémon
                </button>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Ação:</span>
                <select
                  value={newRuleKind}
                  onChange={(e) => setNewRuleKind(e.target.value as "alert" | "snipe")}
                  className="rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-1.5 text-white"
                >
                  <option value="alert">Alerta Discord</option>
                  <option value="snipe">Sniper (Compra)</option>
                </select>
              </div>
            </div>

            {newTarget === "item" ? (
              <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 items-end">
                <div>
                  <label className="block text-slate-400 mb-1">Item ID</label>
                  <input
                    type="number"
                    value={newItemId}
                    onChange={(e) => setNewItemId(Number(e.target.value))}
                    className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Nome</label>
                  <input
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Preço Máx ({moeda})</label>
                  <input
                    type="number"
                    value={newMaxPrice}
                    onChange={(e) => setNewMaxPrice(Number(e.target.value))}
                    className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-amber-300 font-mono"
                  />
                </div>
                <div>
                  <label
                    className="block text-slate-400 mb-1"
                    title="Dispara quando o preço estiver X% abaixo da média de 7 dias (opcional)"
                  >
                    % Abaixo Média 7d
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={95}
                    value={newPctBelow}
                    onChange={(e) => setNewPctBelow(Number(e.target.value))}
                    placeholder="0 = desativado"
                    className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-emerald-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1">Orçamento/dia</label>
                  <input
                    type="number"
                    disabled={newRuleKind !== "snipe"}
                    value={newBudget}
                    onChange={(e) => setNewBudget(Number(e.target.value))}
                    className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-white font-mono disabled:opacity-40"
                  />
                </div>
                <button
                  onClick={handleAddRule}
                  className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold inline-flex items-center justify-center gap-1"
                >
                  <Plus className="w-4 h-4" /> Criar
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5 items-end">
                  <div className="col-span-2">
                    <label className="block text-slate-400 mb-1">Espécie / Busca (vazio = qualquer)</label>
                    <input
                      value={newPokeQuery}
                      onChange={(e) => setNewPokeQuery(e.target.value)}
                      placeholder="Ex.: Gengar, Dragonite..."
                      className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Preço Máx ({moeda})</label>
                    <input
                      type="number"
                      value={newMaxPrice}
                      onChange={(e) => setNewMaxPrice(Number(e.target.value))}
                      className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-amber-300 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">IV Mín (0–192)</label>
                    <input
                      type="number"
                      min={0}
                      max={192}
                      value={newMinIv}
                      onChange={(e) => setNewMinIv(Number(e.target.value))}
                      className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Nível Mín</label>
                    <input
                      type="number"
                      min={0}
                      value={newMinLevel}
                      onChange={(e) => setNewMinLevel(Number(e.target.value))}
                      className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-white font-mono"
                    />
                  </div>
                  <button
                    onClick={handleAddRule}
                    className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold inline-flex items-center justify-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Criar
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-slate-300">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newOnlyShiny}
                      onChange={(e) => setNewOnlyShiny(e.target.checked)}
                    />
                    Só Shiny
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newOnlyP5}
                      onChange={(e) => setNewOnlyP5(e.target.checked)}
                    />
                    Só Potência P5
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newOnlyZMove}
                      onChange={(e) => setNewOnlyZMove(e.target.checked)}
                    />
                    Com Z-Move Elemental
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newOnlyTmAoe}
                      onChange={(e) => setNewOnlyTmAoe(e.target.checked)}
                    />
                    Com TM AoE
                  </label>
                  {newRuleKind === "snipe" && (
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span className="text-slate-400">Orçamento/dia:</span>
                      <input
                        type="number"
                        value={newBudget}
                        onChange={(e) => setNewBudget(Number(e.target.value))}
                        className="w-28 rounded-lg bg-[#0b0e1b] border border-slate-700 px-2 py-1 text-white font-mono"
                      />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Rules List */}
          <div className="space-y-2 text-xs">
            {rules.map((r) => (
              <div
                key={r.id}
                className="rounded-xl bg-[#111525] border border-slate-800 px-4 py-3 flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {r.kind === "snipe" ? (
                    <Crosshair className="w-4 h-4 text-rose-400 shrink-0" />
                  ) : (
                    <Bell className="w-4 h-4 text-sky-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="font-semibold text-white flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                        {r.spec.target === "pokemon" ? "Pokémon" : "Item"}
                      </span>
                      <span>{formatRuleTitle(r)}</span>
                      {r.spec.maxPrice > 0 && (
                        <span className="text-amber-300 font-mono">
                          ≤ {fmtCompact(r.spec.maxPrice)} {r.spec.moeda}
                        </span>
                      )}
                      {r.spec.maxPctBelow && r.spec.maxPctBelow > 0 ? (
                        <span className="text-emerald-300 font-mono">
                          (-{r.spec.maxPctBelow}% média 7d)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-slate-500">
                      {r.kind === "snipe"
                        ? `Orçamento diário: ${fmtCompact(r.spec.dailyBudget)} · Gasto: ${fmtCompact(r.spent)}`
                        : "Alerta no Discord"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => api.toggleMarketRule(r.id).then(loadRules)}
                    className={`px-2.5 py-1 rounded-lg ${
                      r.enabled
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {r.enabled ? "Ativa" : "Pausada"}
                  </button>
                  <button
                    onClick={() => api.deleteMarketRule(r.id).then(loadRules)}
                    className="p-1.5 rounded-lg bg-rose-500/15 text-rose-300"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Market Execution Log */}
          {logs.length > 0 && (
            <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-2 text-xs">
              <div className="font-semibold text-slate-300">Log de Alertas & Sniper</div>
              <div className="max-h-52 overflow-y-auto space-y-1">
                {logs.map((l) => (
                  <div key={l.id} className="flex justify-between gap-2 text-slate-300">
                    <span className="truncate">{l.text}</span>
                    <span className="font-mono text-[10px] text-slate-500 shrink-0">
                      {new Date(l.ts * 1000).toLocaleTimeString("pt-BR")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mine / Read-only Gem Wallet / Fee Calculator */}
      {sub === "mine" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3">
            <div className="font-semibold text-white flex items-center gap-2">
              <Wallet className="w-4 h-4 text-fuchsia-400" /> Carteira de Gemas (Somente Leitura)
            </div>
            <p className="text-slate-500">
              Por segurança, saques de Gemas e envios de Coins são feitos exclusivamente dentro do jogo oficial.
            </p>
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-3 font-mono">
              Saldo: <b className="text-fuchsia-300">{fmtCompact(Number(wallet?.saldo || activeBuyer?.orbs || 0))}</b> Gemas
            </div>
            <div className="font-semibold text-slate-300 pt-2">
              Meus Anúncios ({myListings.length})
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {myListings.map((a, i) => (
                <div key={i} className="rounded-lg bg-[#0b0e1b] px-3 py-1.5 flex justify-between">
                  <span>{String(a.nome || a.descricao || `Anúncio #${a.id}`)}</span>
                  <span className="text-amber-300 font-mono">
                    {fmtCompact(Number(a.preco || 0))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3">
            <div className="font-semibold text-white flex items-center gap-2">
              <Calculator className="w-4 h-4 text-amber-400" /> Calculadora de Comissão
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">Preço de Venda</label>
                <input
                  type="number"
                  value={calcPrice}
                  onChange={(e) => setCalcPrice(Number(e.target.value))}
                  className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-3 py-2 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Taxa (%)</label>
                <input
                  type="number"
                  value={calcFeePct}
                  onChange={(e) => setCalcFeePct(Number(e.target.value))}
                  className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-3 py-2 text-white font-mono"
                />
              </div>
            </div>
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-3 space-y-1 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Taxa:</span>
                <span className="text-rose-300">
                  -{fmtCompact(Math.round((calcPrice * calcFeePct) / 100))}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-300">Você recebe:</span>
                <span className="text-emerald-300 font-bold">
                  {fmtCompact(Math.round(calcPrice * (1 - calcFeePct / 100)))}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Item Listings Modal */}
      {openItem && (
        <div
          onClick={() => setOpenItem(null)}
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-[#111525] border border-slate-700 p-4 space-y-3"
          >
            <div className="flex justify-between items-center">
              <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                <ItemSprite icon={itemsMeta[String(openItem.id)]?.icon} size={24} />
                Anúncios — {itemsMeta[String(openItem.id)]?.name || `Item #${openItem.id}`} ({moeda})
              </h3>
              <button
                onClick={() => setOpenItem(null)}
                className="text-xs text-slate-400 hover:text-white"
              >
                Fechar
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto space-y-1.5 text-xs">
              {openItem.listings.map((ad, idx) => (
                <div
                  key={String(ad.id || idx)}
                  className="rounded-xl bg-[#0b0e1b] border border-slate-800 px-3 py-2 flex items-center justify-between"
                >
                  <div>
                    <div className="font-mono text-amber-300 font-semibold">
                      {fmtCompact(Number(ad.preco || 0))} {moeda}{" "}
                      <span className="text-slate-400">×{Number(ad.qtd || 1)}</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Vendedor: {String(ad.vendedor || "?")}
                    </div>
                  </div>
                  <button
                    onClick={() => handleBuy(ad)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-200 border border-emerald-500/30"
                  >
                    Comprar
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
