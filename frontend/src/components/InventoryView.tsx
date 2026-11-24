import { useEffect, useState } from "react";
import {
  Sparkles,
  Search,
  Coins,
  Gem,
  Trash2,
  Lock,
  Star,
  DollarSign,
  RefreshCw,
} from "lucide-react";
import {
  AccountTelemetry,
  InventorySummary,
  InventoryValuation,
  PokemonDetail,
  fmtCompact,
} from "../lib/types";
import { api } from "../lib/api";
import { ItemSprite, PokemonSprite } from "./PokemonSprite";
import { GRADE_COLORS, PokemonSheetModal } from "./PokemonSheetModal";

function fmtUsd(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "$0.00";
  return `$${v.toFixed(2)}`;
}

export function InventoryView({
  accounts,
  bridgePort,
  onToast,
}: {
  accounts: AccountTelemetry[];
  bridgePort: number;
  onToast: (msg: string) => void;
}) {
  const [subTab, setSubTab] = useState<"items" | "pokemons">("items");
  const [accountFilter, setAccountFilter] = useState<number>(0);
  const [inv, setInv] = useState<InventorySummary | null>(null);
  const [valuation, setValuation] = useState<InventoryValuation | null>(null);
  const [loadingVal, setLoadingVal] = useState(false);
  const [pokemons, setPokemons] = useState<PokemonDetail[]>([]);
  const [sortBy, setSortBy] = useState<"level" | "pvp" | "pve" | "nota" | "iv" | "nome">("level");
  const [search, setSearch] = useState("");
  const [onlyShiny, setOnlyShiny] = useState(false);
  const [onlyTeam, setOnlyTeam] = useState(false);
  const [sheet, setSheet] = useState<PokemonDetail | null>(null);
  const [selling, setSelling] = useState(false);

  const load = () => {
    api
      .getInventory(accountFilter)
      .then((res) => setInv({ ...res, items: Array.isArray(res.items) ? res.items : [] }))
      .catch(() => {});
    api
      .listPokemons(accountFilter, sortBy)
      .then((list) => setPokemons(Array.isArray(list) ? list : []))
      .catch(() => {});
  };

  const loadValuation = async (silent: boolean) => {
    setLoadingVal(true);
    try {
      const val = await api.getInventoryValuation(accountFilter);
      setValuation(val);
    } catch (e) {
      if (!silent) {
        onToast(`Valoração: ${String(e)}`);
      }
    }
    setLoadingVal(false);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [accountFilter, sortBy]);

  useEffect(() => {
    loadValuation(true);
  }, [accountFilter]);

  const q = search.trim().toLowerCase();
  const filteredPks = pokemons.filter((p) => {
    if (onlyShiny && !p.shiny) return false;
    if (onlyTeam && !p.noTime) return false;
    if (q && !p.nome.toLowerCase().includes(q) && !p.apelido.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });

  const handleSellDepot = async () => {
    if (accountFilter === 0) {
      onToast("Selecione uma conta específica para vender o Depot.");
      return;
    }
    const acc = accounts.find((a) => a.id === accountFilter);
    if (
      !confirm(
        `AÇÃO IRREVERSÍVEL: Vender todos os Pokémon desprotegidos do Depot de ${acc?.nick}?`
      )
    ) {
      return;
    }
    const nick = acc?.nick;
    setSelling(true);
    try {
      const res = await api.sellDepot(accountFilter);
      onToast(
        `${nick}: vendidos ${res.qty} Pokémon por ${fmtCompact(res.gained)} Gold!`
      );
      load();
    } catch (e) {
      onToast(`Erro na venda do Depot: ${String(e)}`);
    }
    setSelling(false);
  };

  return (
    <div className="space-y-4">
      {/* Header & Totals */}
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setAccountFilter(0)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${
              accountFilter === 0
                ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                : "bg-[#0b0e1b] text-slate-400 border-slate-800"
            }`}
          >
            Todas ({accounts.length})
          </button>
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setAccountFilter(a.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border ${
                accountFilter === a.id
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-[#0b0e1b] text-slate-400 border-slate-800"
              }`}
            >
              {a.nick}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1 text-amber-300 font-mono font-semibold">
            <Coins className="w-4 h-4" /> {fmtCompact(inv?.totalGold)}
          </span>
          <span className="inline-flex items-center gap-1 text-fuchsia-300 font-mono font-semibold">
            <Gem className="w-4 h-4" /> {fmtCompact(inv?.totalOrbs)}
          </span>
          <span className="text-slate-300">
            Pokémons: <b>{inv?.totalPokemons || 0}</b>
          </span>
          <span className="text-amber-300 inline-flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" /> <b>{inv?.totalShinies || 0}</b>
          </span>
        </div>
      </div>

      {/* Valuation Summary Card (Gems / USD) */}
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-fuchsia-500/15 border border-fuchsia-500/30 flex items-center justify-center text-fuchsia-300">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <div className="font-semibold text-white">
                Valoração Estimada (Média 7d + Cotação da Gema)
              </div>
              <div className="text-[11px] text-slate-400">
                {valuation
                  ? valuation.usdPerGem > 0
                    ? `1 Gema ≈ $${valuation.usdPerGem.toFixed(4)} USD${
                        valuation.pendingShinies > 0
                          ? ` · +${valuation.pendingShinies} shinies aguardando atualização`
                          : ""
                      }`
                    : "Cotação da Gema indisponível no momento"
                  : "Clique em atualizar com pelo menos 1 conta online"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {valuation && (
              <div className="text-right">
                <div className="font-mono font-bold text-base text-fuchsia-300">
                  {fmtCompact(valuation.totalGems)} Gemas
                </div>
                {valuation.usdPerGem > 0 && (
                  <div className="font-mono text-emerald-300 font-semibold">
                    ≈ {fmtUsd(valuation.totalUsd)} USD
                  </div>
                )}
              </div>
            )}
            <button
              disabled={loadingVal}
              onClick={() => loadValuation(false)}
              title="Recalcular valoração do inventário"
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loadingVal ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {valuation && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 px-3 py-2">
                <div className="text-[10px] text-slate-400">Carteira Gemas</div>
                <div className="font-mono font-semibold text-fuchsia-300">
                  {fmtCompact(valuation.orbsBalance)}
                </div>
              </div>
              <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 px-3 py-2">
                <div className="text-[10px] text-slate-400">Itens Raros</div>
                <div className="font-mono font-semibold text-amber-300">
                  {fmtCompact(valuation.rareItemsGems)}
                </div>
              </div>
              <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 px-3 py-2">
                <div className="text-[10px] text-slate-400">
                  Shinies ({valuation.pricedShinies}/{valuation.totalShinies})
                </div>
                <div className="font-mono font-semibold text-yellow-300">
                  {fmtCompact(valuation.shiniesGems)}
                </div>
              </div>
              <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 px-3 py-2">
                <div className="text-[10px] text-slate-400">Outros Itens</div>
                <div className="font-mono font-semibold text-sky-300">
                  {fmtCompact(valuation.otherItemsGems)}
                </div>
              </div>
            </div>

            {(valuation.topEntries || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {valuation.topEntries.slice(0, 6).map((entry) => (
                  <div
                    key={entry.key}
                    className="rounded-lg bg-[#0b0e1b] border border-slate-800 px-2 py-1 inline-flex items-center gap-1.5 text-[11px]"
                  >
                    {entry.kind === "shiny" && entry.looktype ? (
                      <PokemonSprite
                        looktype={entry.looktype}
                        bridgePort={bridgePort}
                        size={18}
                        shiny
                      />
                    ) : entry.icon ? (
                      <ItemSprite icon={entry.icon} size={18} alt={entry.nome} />
                    ) : null}
                    <span className="text-slate-200">
                      {entry.qty}× {entry.nome}
                    </span>
                    <span className="font-mono text-fuchsia-300 font-semibold">
                      {fmtCompact(entry.totalGems)}g
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1 bg-[#111525] p-1 rounded-xl border border-slate-800 text-xs">
          <button
            onClick={() => setSubTab("items")}
            className={`px-3.5 py-1.5 rounded-lg font-medium ${
              subTab === "items" ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Itens ({inv?.items.length || 0})
          </button>
          <button
            onClick={() => setSubTab("pokemons")}
            className={`px-3.5 py-1.5 rounded-lg font-medium ${
              subTab === "pokemons" ? "bg-indigo-500 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Pokémons ({pokemons.length})
          </button>
        </div>

        {subTab === "pokemons" && (
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar espécie..."
                className="pl-8 pr-3 py-1.5 rounded-lg bg-[#111525] border border-slate-700 text-white w-44"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="rounded-lg bg-[#111525] border border-slate-700 px-2.5 py-1.5 text-slate-200"
            >
              <option value="level">Ordenar: Nível</option>
              <option value="pvp">Ordenar: Poder PvP</option>
              <option value="pve">Ordenar: Poder PvE</option>
              <option value="nota">Ordenar: Nota</option>
              <option value="iv">Ordenar: IV</option>
              <option value="nome">Ordenar: Nome</option>
            </select>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#111525] border border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyShiny}
                onChange={(e) => setOnlyShiny(e.target.checked)}
              />
              Só Shiny
            </label>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#111525] border border-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={onlyTeam}
                onChange={(e) => setOnlyTeam(e.target.checked)}
              />
              Só Time
            </label>
            {accountFilter > 0 && (
              <button
                disabled={selling}
                onClick={handleSellDepot}
                className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/30 inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {selling ? "Vendendo..." : "Vender Depot"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Items Grid */}
      {subTab === "items" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
          {(inv?.items || []).map((it) => (
            <div
              key={`${it.kind}-${it.id}`}
              className="rounded-xl bg-[#111525] border border-slate-800 p-3 space-y-2 hover:border-slate-700 transition"
            >
              <div className="flex items-center gap-2.5">
                {it.icon ? (
                  <img
                    src={it.icon}
                    alt={it.nome}
                    className="w-8 h-8 object-contain pixelated shrink-0"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-slate-800 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-white truncate" title={it.nome}>
                    {it.nome}
                  </div>
                  <div className="text-sm font-mono font-bold text-amber-300">
                    {fmtCompact(it.total)}
                  </div>
                </div>
              </div>
              {it.accounts.length > 1 && (
                <div className="border-t border-slate-800/80 pt-1.5 space-y-0.5 text-[11px] text-slate-400">
                  {it.accounts.map((a) => (
                    <div key={a.accountId} className="flex justify-between">
                      <span className="truncate">{a.nick}</span>
                      <span className="font-mono text-slate-300">{fmtCompact(a.qty)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Pokemons Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredPks.slice(0, 120).map((pk) => (
            <button
              key={`${pk.accountId}-${pk.id}`}
              onClick={() => setSheet(pk)}
              className={`text-left rounded-xl border p-3 flex items-center gap-3 transition ${
                pk.shiny
                  ? "bg-amber-500/5 border-amber-500/35 hover:border-amber-400"
                  : "bg-[#111525] border-slate-800 hover:border-indigo-500/50"
              }`}
            >
              <PokemonSprite
                looktype={pk.looktype}
                bridgePort={bridgePort}
                size={48}
                shiny={pk.shiny}
                className="rounded-lg bg-[#090c18] border border-slate-800"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-semibold text-sm text-white truncate">
                    {pk.apelido || pk.nome}
                  </span>
                  <span className="text-xs font-mono text-amber-300 shrink-0">
                    Lv {pk.level}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5 flex-wrap">
                  <span className={GRADE_COLORS[pk.faixa] || "text-slate-300"}>
                    Nota <b>{pk.nota.toFixed(2)}</b>
                  </span>
                  <span>·</span>
                  <span className="font-mono">IV {pk.ivPct.toFixed(0)}%</span>
                  <span>·</span>
                  <span>P{pk.potencia}</span>
                  {pk.pvpPower > 0 && (
                    <>
                      <span>·</span>
                      <span className="font-mono text-rose-300">
                        PvP {fmtCompact(pk.pvpPower)}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1">
                  <span>{pk.accountNick}</span>
                  <span className="flex items-center gap-1">
                    {pk.ativo && <Star className="w-3 h-3 text-amber-400" />}
                    {pk.trancado && <Lock className="w-3 h-3 text-sky-400" />}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Complete Pokemon Sheet Modal (Hexagonal IV Radar + PvP/PvE Power + Branched Evolutions) */}
      {sheet && (
        <PokemonSheetModal
          sheet={sheet}
          bridgePort={bridgePort}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
