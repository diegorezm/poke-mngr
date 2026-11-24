import { useEffect, useState } from "react";
import {
  Sparkles,
  Search,
  Coins,
  Gem,
  Trash2,
  X,
  Lock,
  Star,
} from "lucide-react";
import {
  AccountTelemetry,
  InventorySummary,
  PokemonDetail,
  fmtCompact,
} from "../lib/types";
import { api } from "../lib/api";
import { TYPE_COLOR } from "../lib/gameData";
import { PokemonSprite } from "./PokemonSprite";

const GRADE_COLORS: Record<string, string> = {
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
  const [pokemons, setPokemons] = useState<PokemonDetail[]>([]);
  const [sortBy, setSortBy] = useState<"level" | "nota" | "iv" | "nome">("level");
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

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [accountFilter, sortBy]);

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
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                  <span className={GRADE_COLORS[pk.faixa] || "text-slate-300"}>
                    Nota <b>{pk.nota.toFixed(2)}</b>
                  </span>
                  <span>·</span>
                  <span className="font-mono">IV {pk.ivPct.toFixed(0)}%</span>
                  <span>·</span>
                  <span>P{pk.potencia}</span>
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

      {/* PokemonSheet Modal with Hexagonal IV Radar + Birth Grade */}
      {sheet && (
        <div
          onClick={() => setSheet(null)}
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-[#111525] border border-slate-700 shadow-2xl p-5 space-y-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <PokemonSprite
                  looktype={sheet.looktype}
                  bridgePort={bridgePort}
                  size={64}
                  shiny={sheet.shiny}
                  className="rounded-xl bg-[#090c18] border border-slate-800"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-white">
                      {sheet.apelido || sheet.nome}
                    </h3>
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-slate-800 text-amber-300">
                      Lv {sheet.level}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {sheet.accountNick} · Potência P{sheet.potencia} · Qualidade{" "}
                    {sheet.qualidade.toFixed(2)}
                  </div>
                  <div className="flex gap-1 mt-1">
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
                onClick={() => setSheet(null)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Birth Grade Meter */}
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Nota de Nascença</span>
                <span className={`font-bold uppercase ${GRADE_COLORS[sheet.faixa]}`}>
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
          </div>
        </div>
      )}
    </div>
  );
}

function IVRadar({ ivs }: { ivs: Record<string, number> }) {
  const cx = 80;
  const cy = 80;
  const r = 56;
  const pts = STAT_LABELS.map(([k], i) => {
    const angle = (-Math.PI / 2) + (i * 2 * Math.PI) / 6;
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
