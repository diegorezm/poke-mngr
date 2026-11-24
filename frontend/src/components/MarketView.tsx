import { useEffect, useMemo, useState } from "react";
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
  Calculator,
  Search,
} from "lucide-react";
import {
  AccountTelemetry,
  MarketLogEntry,
  MarketRule,
  fmtCompact,
} from "../lib/types";
import { api } from "../lib/api";
import { ItemSprite, PokemonSprite } from "./PokemonSprite";

type MarketSubTab = "prices" | "vitrine" | "tape" | "stats" | "rules" | "mine";

interface ItemMetaEntry {
  id: number;
  name: string;
  icon: string;
  category?: string;
  rare?: boolean;
}

export function MarketView({
  accounts,
  bridgePort,
  onToast,
}: {
  accounts: AccountTelemetry[];
  bridgePort: number;
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

  // Guide Stats
  const [guideDays, setGuideDays] = useState(7);
  const [guideStats, setGuideStats] = useState<Record<string, unknown> | null>(null);

  // Rules & Sniper
  const [sniperEnabled, setSniperEnabled] = useState(false);
  const [rules, setRules] = useState<MarketRule[]>([]);
  const [logs, setLogs] = useState<MarketLogEntry[]>([]);
  const [newRuleKind, setNewRuleKind] = useState<"alert" | "snipe">("alert");
  const [newItemId, setNewItemId] = useState(70000);
  const [newItemName, setNewItemName] = useState("Bronze Boss Token");
  const [newMaxPrice, setNewMaxPrice] = useState(100000);
  const [newBudget, setNewBudget] = useState(500000);

  // Mine & Wallet + Fee Calc
  const [myListings, setMyListings] = useState<Record<string, unknown>[]>([]);
  const [wallet, setWallet] = useState<Record<string, unknown> | null>(null);
  const [calcPrice, setCalcPrice] = useState(1000000);
  const [calcFeePct, setCalcFeePct] = useState(5);

  const onlineAccounts = accounts.filter((a) => a.state === "ONLINE");
  const activeBuyer = onlineAccounts.find((a) => a.id === buyerId) || onlineAccounts[0];

  const loadOverview = async () => {
    setLoading(true);
    try {
      const ov = await api.getMarketOverview();
      setOverview(ov);
      setSniperEnabled(Boolean(ov?.sniperEnabled));
    } catch (e) {
      onToast(`Mercado: ${String(e)}`);
    } finally {
      setLoading(false);
    }
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

  const itemRows = useMemo(() => {
    const resumo = (overview?.resumo as Record<string, Record<string, number>>) || {};
    const medias = (overview?.medias as Record<string, Record<string, { media?: number }>>) || {};
    const favs = new Set<number>((overview?.favs as number[]) || []);
    const q = search.trim().toLowerCase();

    return Object.entries(resumo)
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
  }, [overview, moeda, search]);

  const handleOpenItem = async (itemId: number) => {
    if (!activeBuyer) return;
    try {
      const res = await api.getMarketItemListings(itemId, moeda, activeBuyer.id);
      setOpenItem({ id: itemId, listings: (res.linhas as Record<string, unknown>[]) || [] });
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
    try {
      await api.saveMarketRule({
        id: 0,
        kind: newRuleKind,
        enabled: true,
        spec: {
          target: "item",
          itemId: newItemId,
          itemName: newItemName || `Item #${newItemId}`,
          moeda,
          maxPrice: newMaxPrice,
          dailyBudget: newRuleKind === "snipe" ? newBudget : 0,
          accountIds: activeBuyer ? [activeBuyer.id] : [],
        },
        spent: 0,
        spentDay: "",
        lastFire: 0,
        createdAt: 0,
      });
      onToast("Regra criada!");
      loadRules();
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

      {/* Stats Tab (pokeidleguide.io) */}
      {sub === "stats" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs">
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
          <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3 text-xs">
            {!guideStats ? (
              <div className="text-slate-400">Carregando dados do pokeidleguide.io...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {((guideStats.maisVendidos as Record<string, unknown>[]) || [])
                  .slice(0, 16)
                  .map((mv, i) => (
                    <div
                      key={i}
                      className="rounded-xl bg-[#0b0e1b] border border-slate-800 px-3 py-2 flex justify-between"
                    >
                      <span className="text-white font-medium">{String(mv.nome || "?")}</span>
                      <span className="font-mono text-amber-300">
                        {fmtCompact(Number(mv.mediana || mv.media || 0))} · {Number(mv.vendas || 0)} vendas
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Rules & Sniper Tab */}
      {sub === "rules" && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-white flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-rose-400" /> Sniper Multi-Conta (Chave Geral)
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Dispara em <code>compravelEm + 20ms</code> sincronizado no relógio do servidor, respeita orçamento diário e nunca compra das próprias contas.
              </p>
            </div>
            <button
              onClick={handleToggleSniper}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition ${
                sniperEnabled
                  ? "bg-emerald-500 text-slate-950"
                  : "bg-slate-800 text-slate-300 border border-slate-700"
              }`}
            >
              {sniperEnabled ? "SNIPER: LIGADO" : "SNIPER: DESLIGADO"}
            </button>
          </div>

          {/* Add Rule Form */}
          <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 grid grid-cols-2 md:grid-cols-6 gap-2.5 items-end text-xs">
            <div>
              <label className="block text-slate-400 mb-1">Tipo</label>
              <select
                value={newRuleKind}
                onChange={(e) => setNewRuleKind(e.target.value as "alert" | "snipe")}
                className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2 py-2 text-white"
              >
                <option value="alert">Alerta Discord</option>
                <option value="snipe">Sniper (Compra)</option>
              </select>
            </div>
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

          {/* Rules List */}
          <div className="space-y-2 text-xs">
            {rules.map((r) => (
              <div
                key={r.id}
                className="rounded-xl bg-[#111525] border border-slate-800 px-4 py-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  {r.kind === "snipe" ? (
                    <Crosshair className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Bell className="w-4 h-4 text-sky-400" />
                  )}
                  <div>
                    <div className="font-semibold text-white">
                      {r.spec.itemName || `Item #${r.spec.itemId}`} ≤{" "}
                      <span className="text-amber-300 font-mono">
                        {fmtCompact(r.spec.maxPrice)} {r.spec.moeda}
                      </span>
                    </div>
                    <div className="text-slate-500">
                      {r.kind === "snipe"
                        ? `Orçamento diário: ${fmtCompact(r.spec.dailyBudget)} · Gasto: ${fmtCompact(r.spent)}`
                        : "Alerta no Discord"}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
