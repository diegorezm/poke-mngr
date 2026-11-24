import { useEffect, useState } from "react";
import { Tab, TabGroup, TabList } from "@headlessui/react";
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
import { DsConfirmDialog, DsSwitch, DsTypeBadge } from "./DsPrimitives";

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
  const [confirmSellDepot, setConfirmSellDepot] = useState(false);
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

  const selectedSellAcc = accounts.find((a) => a.id === accountFilter);

  const handleSellDepot = () => {
    if (accountFilter === 0) {
      onToast("Selecione uma conta específica para vender o Depot.");
      return;
    }
    setConfirmSellDepot(true);
  };

  const handleConfirmSellDepot = async () => {
    if (accountFilter === 0) return;
    const nick = selectedSellAcc?.nick || "";
    setSelling(true);
    try {
      const res = await api.sellDepot(accountFilter);
      setConfirmSellDepot(false);
      onToast(
        `${nick}: vendidos ${res.qty} Pokémon por ${fmtCompact(res.gained)} Gold!`
      );
      load();
    } catch (e) {
      onToast(`Erro na venda do Depot: ${String(e)}`);
    }
    setSelling(false);
  };

  const selectedTabIndex = subTab === "items" ? 0 : 1;

  return (
    <div className="space-y-4">
      {/* Header & Totals */}
      <div className="px-box p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setAccountFilter(0)}
            className={`ds-btn ds-btn-sm ${
              accountFilter === 0 ? "ds-btn-orange" : "ds-btn-slate"
            }`}
          >
            Todas ({accounts.length})
          </button>
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setAccountFilter(a.id)}
              className={`ds-btn ds-btn-sm ${
                accountFilter === a.id ? "ds-btn-orange" : "ds-btn-slate"
              }`}
            >
              {a.nick}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-4 text-xs font-bold">
          <span className="inline-flex items-center gap-1 font-pixel text-[11px] text-[var(--ink-accent-amber)]">
            <Coins className="w-4 h-4" /> {fmtCompact(inv?.totalGold)}
          </span>
          <span className="inline-flex items-center gap-1 font-pixel text-[11px] text-[var(--ink-accent-fuchsia)]">
            <Gem className="w-4 h-4" /> {fmtCompact(inv?.totalOrbs)}
          </span>
          <span className="text-[var(--ink)]">
            Pokémons: <b className="font-pixel text-[10px]">{inv?.totalPokemons || 0}</b>
          </span>
          <span className="text-[var(--ink-accent-amber)] inline-flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />{" "}
            <b className="font-pixel text-[10px]">{inv?.totalShinies || 0}</b>
          </span>
        </div>
      </div>

      {/* Valuation Summary Card (Gems / USD) */}
      <div className="px-box p-4 space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#1b1f26] border border-[#2f3644] flex items-center justify-center text-[#fde047]">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <div className="font-pixel text-[11px] text-[var(--ink)]">
                VALORAÇÃO ESTIMADA (7D + GEMA)
              </div>
              <div className="text-[11px] text-[var(--ink-muted)] font-semibold">
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
                <div className="font-pixel text-sm text-[var(--ink-accent-fuchsia)]">
                  {fmtCompact(valuation.totalGems)} Gemas
                </div>
                {valuation.usdPerGem > 0 && (
                  <div className="font-pixel text-[11px] text-[var(--ink-accent-green)]">
                    ≈ {fmtUsd(valuation.totalUsd)} USD
                  </div>
                )}
              </div>
            )}
            <button
              disabled={loadingVal}
              onClick={() => loadValuation(false)}
              title="Recalcular valoração do inventário"
              className="ds-btn ds-btn-blue ds-btn-sm !p-2"
            >
              <RefreshCw className={`w-4 h-4 ${loadingVal ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {valuation && (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="px-inset px-3 py-2">
                <div className="font-pixel text-[8px] text-[var(--ink-muted)]">CARTEIRA GEMAS</div>
                <div className="font-pixel text-[12px] text-[var(--ink-accent-fuchsia)] mt-0.5">
                  {fmtCompact(valuation.orbsBalance)}
                </div>
              </div>
              <div className="px-inset px-3 py-2">
                <div className="font-pixel text-[8px] text-[var(--ink-muted)]">ITENS RAROS</div>
                <div className="font-pixel text-[12px] text-[var(--ink-accent-amber)] mt-0.5">
                  {fmtCompact(valuation.rareItemsGems)}
                </div>
              </div>
              <div className="px-inset px-3 py-2">
                <div className="font-pixel text-[8px] text-[var(--ink-muted)]">
                  SHINIES ({valuation.pricedShinies}/{valuation.totalShinies})
                </div>
                <div className="font-pixel text-[12px] text-[var(--ink-accent-amber)] mt-0.5">
                  {fmtCompact(valuation.shiniesGems)}
                </div>
              </div>
              <div className="px-inset px-3 py-2">
                <div className="font-pixel text-[8px] text-[var(--ink-muted)]">OUTROS ITENS</div>
                <div className="font-pixel text-[12px] text-[var(--ink-accent-sky)] mt-0.5">
                  {fmtCompact(valuation.otherItemsGems)}
                </div>
              </div>
            </div>

            {(valuation.topEntries || []).length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {valuation.topEntries.slice(0, 6).map((entry) => (
                  <div
                    key={entry.key}
                    className="px-inset px-2 py-1 inline-flex items-center gap-1.5 text-[11px] font-bold"
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
                    <span className="text-[var(--ink)]">
                      {entry.qty}× {entry.nome}
                    </span>
                    <span className="font-pixel text-[9px] text-[var(--ink-accent-fuchsia)]">
                      {fmtCompact(entry.totalGems)}g
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Headless UI Sub-tabs & PC Box Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <TabGroup
          selectedIndex={selectedTabIndex}
          onChange={(idx) => setSubTab(idx === 0 ? "items" : "pokemons")}
        >
          <TabList className="inline-flex items-center gap-1.5">
            <Tab className="ds-tab-btn focus:outline-none">
              Mochila · Itens ({inv?.items.length || 0})
            </Tab>
            <Tab className="ds-tab-btn focus:outline-none">
              PC Box · Pokémons ({pokemons.length})
            </Tab>
          </TabList>
        </TabGroup>

        {subTab === "pokemons" && (
          <div className="flex items-center gap-2.5 flex-wrap text-xs">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[var(--ink-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar espécie..."
                className="pl-8 pr-3 py-1.5 w-44"
              />
            </div>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-2.5 py-1.5 font-bold"
            >
              <option value="level">Ordenar: Nível</option>
              <option value="pvp">Ordenar: Poder PvP</option>
              <option value="pve">Ordenar: Poder PvE</option>
              <option value="nota">Ordenar: Nota</option>
              <option value="iv">Ordenar: IV</option>
              <option value="nome">Ordenar: Nome</option>
            </select>
            <DsSwitch checked={onlyShiny} onChange={setOnlyShiny} label="Só Shiny" />
            <DsSwitch checked={onlyTeam} onChange={setOnlyTeam} label="Só Time" />
            {accountFilter > 0 && (
              <button
                disabled={selling}
                onClick={handleSellDepot}
                className="ds-btn ds-btn-red ds-btn-sm"
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 animate-ds-tab">
          {(inv?.items || []).map((it) => (
            <div
              key={`${it.kind}-${it.id}`}
              className="px-box p-3 space-y-2 transition-transform hover:-translate-y-0.5"
            >
              <div className="flex items-center gap-2.5">
                {it.icon ? (
                  <div className="px-stage !border-2 w-10 h-10 flex items-center justify-center shrink-0">
                    <img
                      src={it.icon}
                      alt={it.nome}
                      className="w-7 h-7 object-contain pixelated"
                    />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-md bg-[var(--panel-alt)] border-2 border-[var(--border-dark)] shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-xs font-bold text-[var(--ink)] truncate" title={it.nome}>
                    {it.nome}
                  </div>
                  <div className="font-pixel text-[12px] text-[var(--ink-accent-amber)]">
                    {fmtCompact(it.total)}
                  </div>
                </div>
              </div>
              {it.accounts.length > 1 && (
                <div className="border-t-2 border-[var(--border-mid)]/30 pt-1.5 space-y-0.5 text-[11px] text-[var(--ink-muted)] font-semibold">
                  {it.accounts.map((a) => (
                    <div key={a.accountId} className="flex justify-between">
                      <span className="truncate">{a.nick}</span>
                      <span className="font-pixel text-[9px] text-[var(--ink)]">
                        {fmtCompact(a.qty)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* PC Box Pokémons Grid */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 animate-ds-tab">
          {filteredPks.slice(0, 120).map((pk) => (
            <button
              key={`${pk.accountId}-${pk.id}`}
              onClick={() => setSheet(pk)}
              className={`group text-left px-box p-3 flex items-center gap-3 transition-all hover:-translate-y-0.5 hover:border-[var(--dex-red)] cursor-pointer ${
                pk.shiny ? "!border-amber-500 ring-2 ring-amber-400/40" : ""
              }`}
            >
              <div className="px-stage !border-2 w-16 h-16 flex items-center justify-center shrink-0 relative">
                <div className="group-hover:animate-ds-idle">
                  <PokemonSprite
                    looktype={pk.looktype}
                    bridgePort={bridgePort}
                    size={54}
                    shiny={pk.shiny}
                  />
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="font-pixel text-[11px] text-[var(--ink)] truncate">
                    {pk.apelido || pk.nome}
                  </span>
                  <span className="font-pixel text-[9px] bg-[#2f3842] text-[#ffd84a] px-1.5 py-0.5 rounded shrink-0">
                    Lv.{pk.level}
                  </span>
                </div>
                {(pk.tipos || []).length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {(pk.tipos || []).slice(0, 2).map((t) => (
                      <DsTypeBadge key={t} type={t} />
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)] font-bold flex-wrap">
                  <span className={GRADE_COLORS[pk.faixa] || "text-[var(--ink)]"}>
                    Nota {pk.nota.toFixed(2)}
                  </span>
                  <span>·</span>
                  <span>IV {pk.ivPct.toFixed(0)}%</span>
                  {pk.pvpPower > 0 && (
                    <>
                      <span>·</span>
                      <span className="text-[var(--ink-accent-rose)]">
                        PvP {fmtCompact(pk.pvpPower)}
                      </span>
                    </>
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-[var(--ink-subtle)] font-semibold">
                  <span>{pk.accountNick}</span>
                  <span className="flex items-center gap-1">
                    {pk.ativo && <Star className="w-3 h-3 text-[#e08218]" />}
                    {pk.trancado && <Lock className="w-3 h-3 text-[#3688d0]" />}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Complete Gen 4/5 SKILLS Pokemon Sheet Modal */}
      {sheet && (
        <PokemonSheetModal
          sheet={sheet}
          bridgePort={bridgePort}
          onClose={() => setSheet(null)}
        />
      )}

      {/* Sell Depot Confirm Dialog */}
      <DsConfirmDialog
        open={confirmSellDepot}
        title="Vender Depot inteiro?"
        description={`AÇÃO IRREVERSÍVEL: Vender todos os Pokémon desprotegidos do Depot de ${selectedSellAcc?.nick || ""}?`}
        confirmLabel="Vender Depot"
        tone="danger"
        busy={selling}
        onConfirm={handleConfirmSellDepot}
        onClose={() => setConfirmSellDepot(false)}
      />
    </div>
  );
}
