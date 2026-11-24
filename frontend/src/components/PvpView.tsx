import { useEffect, useState } from "react";
import { Swords, Trophy, Play, Square, Save, Crown } from "lucide-react";
import { PokemonDetail, PvpAccountView, fmtCompact } from "../lib/types";
import { api } from "../lib/api";
import { PokemonSprite } from "./PokemonSprite";

// Exact 5-row, 30-tile asymmetric PvP board from pokeidle-manager-online (pvp_power.py)
const BOARD_ROWS = [
  { row: 0, start: 0, count: 6 },
  { row: 1, start: 6, count: 8 },
  { row: 2, start: 14, count: 8 },
  { row: 3, start: 22, count: 4 },
  { row: 4, start: 26, count: 4 },
];

export function PvpView({
  bridgePort,
  onToast,
}: {
  bridgePort: number;
  onToast: (msg: string) => void;
}) {
  const [sub, setSub] = useState<"overview" | "team" | "ladder" | "monthly">("overview");
  const [views, setViews] = useState<PvpAccountView[]>([]);
  const [selectedAcc, setSelectedAcc] = useState<number>(0);

  // Team editor
  const [roster, setRoster] = useState<PokemonDetail[]>([]);
  const [draftTeam, setDraftTeam] = useState<number[]>([]);
  const [draftHouses, setDraftHouses] = useState<Record<string, number>>({});
  const [placingPk, setPlacingPk] = useState<number | null>(null);

  // Ladder & Monthly
  const [ladderPage, setLadderPage] = useState(1);
  const [ladder, setLadder] = useState<Record<string, unknown> | null>(null);
  const [monthly, setMonthly] = useState<Record<string, unknown> | null>(null);

  const load = () => {
    api
      .getPvpOverview()
      .then((list) => setViews(Array.isArray(list) ? list : []))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, []);

  const current = views.find((v) => v.accountId === selectedAcc) || views[0];

  useEffect(() => {
    if (sub === "team" && current) {
      setDraftTeam(current.team || []);
      setDraftHouses(current.houses || {});
      api
        .listPokemons(current.accountId, "level")
        .then((l) => setRoster(Array.isArray(l) ? l : []))
        .catch(() => {});
    } else if (sub === "ladder" && current) {
      api
        .getPvpLadder(current.accountId, ladderPage)
        .then(setLadder)
        .catch((e) => onToast(String(e)));
    } else if (sub === "monthly" && current) {
      api
        .getPvpMonthly(current.accountId, 0)
        .then(setMonthly)
        .catch((e) => onToast(String(e)));
    }
  }, [sub, current?.accountId, ladderPage]);

  const handleToggleAuto = async (v: PvpAccountView) => {
    try {
      await api.setPvpAuto(v.accountId, !v.auto);
      onToast(`${v.nick}: Auto-Fila PvP ${!v.auto ? "LIGADA" : "DESLIGADA"}`);
      load();
    } catch (e) {
      onToast(String(e));
    }
  };

  const handleQueue = async (v: PvpAccountView, enter: boolean) => {
    try {
      await api.pvpQueueAction(v.accountId, enter);
      onToast(`${v.nick}: ${enter ? "entrou na fila PvP" : "saiu da fila PvP"}`);
      load();
    } catch (e) {
      onToast(String(e));
    }
  };

  const toggleInTeam = (pkId: number) => {
    if (draftTeam.includes(pkId)) {
      setDraftTeam((t) => t.filter((x) => x !== pkId));
      setDraftHouses((h) => {
        const next = { ...h };
        delete next[String(pkId)];
        return next;
      });
      return;
    }
    if (draftTeam.length >= 5) {
      onToast("Máximo de 5 Pokémon no time PvP.");
      return;
    }
    const used = new Set(Object.values(draftHouses));
    let freeHouse = 0;
    while (used.has(freeHouse) && freeHouse < 29) freeHouse++;
    setDraftTeam((t) => [...t, pkId]);
    setDraftHouses((h) => ({ ...h, [String(pkId)]: freeHouse }));
  };

  const placeAtHouse = (house: number) => {
    if (!placingPk) return;
    setDraftHouses((prev) => {
      const next = { ...prev };
      for (const [k, v] of Object.entries(next)) {
        if (v === house) next[k] = prev[String(placingPk)] ?? 0;
      }
      next[String(placingPk)] = house;
      return next;
    });
    setPlacingPk(null);
  };

  const handleSaveTeam = async () => {
    if (!current) return;
    try {
      await api.savePvpTeam(current.accountId, draftTeam, draftHouses);
      onToast(`${current.nick}: equipe PvP salva no jogo!`);
      load();
    } catch (e) {
      onToast(`Erro ao salvar equipe: ${String(e)}`);
    }
  };

  const rosterById = new Map(roster.map((p) => [p.id, p]));

  return (
    <div className="space-y-4">
      {/* Nav */}
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-1.5">
          {(
            [
              ["overview", "Visão Geral & Auto-Fila"],
              ["team", "Editor de Time (30 Casas)"],
              ["ladder", "Top 1.000 Semanal"],
              ["monthly", "Mensal (Gemas)"],
            ] as const
          ).map(([id, lbl]) => (
            <button
              key={id}
              onClick={() => setSub(id)}
              className={`px-3 py-1.5 rounded-xl font-medium border ${
                sub === id
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-[#0b0e1b] text-slate-400 border-slate-800 hover:text-white"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          {views.map((v) => (
            <button
              key={v.accountId}
              onClick={() => setSelectedAcc(v.accountId)}
              className={`px-2.5 py-1 rounded-lg border ${
                current?.accountId === v.accountId
                  ? "bg-indigo-500/25 text-indigo-200 border-indigo-500/40"
                  : "bg-[#0b0e1b] text-slate-400 border-slate-800"
              }`}
            >
              {v.nick}
            </button>
          ))}
        </div>
      </div>

      {/* Overview */}
      {sub === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {views.map((v) => {
            const pts = Number(v.rank?.pontos || 0);
            const rankName = String(v.rank?.nome || v.rank?.elo || "Sem elo");
            return (
              <div
                key={v.accountId}
                className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">{v.nick}</span>
                      <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                        {rankName} · {fmtCompact(pts)} PR
                      </span>
                      {v.position > 0 && (
                        <span className="text-amber-300 font-mono">#{v.position}</span>
                      )}
                    </div>
                    <div className="text-slate-400 mt-0.5">
                      Sessão: <b className="text-emerald-300">{v.wins}V</b> /{" "}
                      <b className="text-rose-300">{v.losses}D</b> (
                      <span className={v.delta >= 0 ? "text-emerald-300" : "text-rose-300"}>
                        {v.delta >= 0 ? `+${v.delta}` : v.delta} PR
                      </span>
                      ) · Time: {v.team.length}/5
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleToggleAuto(v)}
                      className={`px-2.5 py-1.5 rounded-lg font-semibold border ${
                        v.auto
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                          : "bg-slate-800 text-slate-400 border-slate-700"
                      }`}
                    >
                      Auto-Fila: {v.auto ? "ON" : "OFF"}
                    </button>
                    <button
                      disabled={!v.online}
                      onClick={() => handleQueue(v, !v.inQueue)}
                      className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-200 border border-indigo-500/30 disabled:opacity-40"
                      title={v.inQueue ? "Sair da fila" : "Entrar na fila agora"}
                    >
                      {v.inQueue ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                {v.inQueue && (
                  <div className="rounded-lg bg-sky-500/10 border border-sky-500/25 px-3 py-1.5 text-sky-200 flex items-center gap-2">
                    <Swords className="w-3.5 h-3.5 animate-pulse" /> Na fila PvP ({v.queueSize} buscando)
                  </div>
                )}
                {v.refusal && (
                  <div className="rounded-lg bg-rose-500/10 border border-rose-500/25 px-3 py-1.5 text-rose-200">
                    {v.refusal} {v.waitSec > 0 ? `(nova tentativa em ${v.waitSec}s)` : ""}
                  </div>
                )}

                {v.matches.length > 0 && (
                  <div className="space-y-1 max-h-36 overflow-y-auto pt-1 border-t border-slate-800/80">
                    {v.matches.slice(0, 6).map((m, i) => (
                      <div key={i} className="flex justify-between">
                        <span className={m.won ? "text-emerald-300" : "text-rose-300"}>
                          {m.won ? "Vitória" : "Derrota"} vs {m.opponent || "?"}
                        </span>
                        <span className="font-mono text-slate-400">
                          {m.delta >= 0 ? `+${m.delta}` : m.delta} PR
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Team & 30-Tile Board Editor */}
      {sub === "team" && current && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-white">
                Tabuleiro da Arena (30 casas) — {current.nick}
              </div>
              <button
                onClick={handleSaveTeam}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold inline-flex items-center gap-1"
              >
                <Save className="w-3.5 h-3.5" /> Salvar Time ({draftTeam.length}/5)
              </button>
            </div>
            <p className="text-slate-400">
              Clique num Pokémon do seu time abaixo e depois clique numa casa do tabuleiro para posicioná-lo.
            </p>

            {/* 5-row asymmetric arena board */}
            <div className="rounded-xl bg-[#1a1410] border border-amber-900/40 p-3 space-y-1.5">
              {BOARD_ROWS.map((r) => (
                <div key={r.row} className="flex justify-center gap-1.5">
                  {Array.from({ length: r.count }, (_, idx) => {
                    const house = r.start + idx;
                    const occupantId = Object.entries(draftHouses).find(
                      ([id, h]) => h === house && draftTeam.includes(Number(id))
                    )?.[0];
                    const occ = occupantId ? rosterById.get(Number(occupantId)) : undefined;
                    return (
                      <button
                        key={house}
                        onClick={() => {
                          if (placingPk) placeAtHouse(house);
                          else if (occ) setPlacingPk(occ.id);
                        }}
                        className={`w-12 h-12 rounded-lg border flex flex-col items-center justify-center transition ${
                          placingPk
                            ? "border-amber-400/60 bg-amber-500/10 hover:bg-amber-500/25"
                            : occ
                            ? "border-indigo-400/60 bg-indigo-500/20"
                            : "border-amber-900/40 bg-black/30 hover:border-amber-700/60"
                        }`}
                        title={`Casa ${house}${occ ? ` — ${occ.nome}` : ""}`}
                      >
                        {occ ? (
                          <PokemonSprite looktype={occ.looktype} bridgePort={bridgePort} size={34} />
                        ) : (
                          <span className="text-[9px] text-amber-800/70 font-mono">{house}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Selected team strip */}
            <div className="flex flex-wrap gap-2">
              {draftTeam.map((id) => {
                const pk = rosterById.get(id);
                const selected = placingPk === id;
                return (
                  <button
                    key={id}
                    onClick={() => setPlacingPk(selected ? null : id)}
                    className={`px-2.5 py-1.5 rounded-xl border flex items-center gap-2 ${
                      selected
                        ? "bg-amber-500/25 border-amber-400 text-amber-200"
                        : "bg-[#0b0e1b] border-slate-700 text-slate-200"
                    }`}
                  >
                    <PokemonSprite looktype={pk?.looktype} bridgePort={bridgePort} size={24} />
                    <span>{pk?.nome || `#${id}`}</span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      C{draftHouses[String(id)] ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Roster picker */}
          <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-2">
            <div className="font-semibold text-white">
              Pokémon da Conta ({roster.length}) — clique para adicionar/remover
            </div>
            <div className="max-h-[28rem] overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {roster.slice(0, 80).map((pk) => {
                const inTeam = draftTeam.includes(pk.id);
                return (
                  <button
                    key={pk.id}
                    onClick={() => toggleInTeam(pk.id)}
                    className={`rounded-xl border px-2.5 py-2 flex items-center justify-between text-left ${
                      inTeam
                        ? "bg-indigo-500/20 border-indigo-400/60"
                        : "bg-[#0b0e1b] border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <PokemonSprite looktype={pk.looktype} bridgePort={bridgePort} size={32} shiny={pk.shiny} />
                      <div className="min-w-0">
                        <div className="font-medium text-white truncate">{pk.apelido || pk.nome}</div>
                        <div className="text-[10px] text-slate-400">
                          Lv {pk.level} · Nota {pk.nota.toFixed(1)}
                        </div>
                      </div>
                    </div>
                    {inTeam && <span className="text-[10px] text-indigo-300 font-bold">TIME</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Weekly Ladder */}
      {sub === "ladder" && (
        <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-white flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" /> Ranking Semanal (Página {ladderPage})
            </div>
            <div className="flex gap-1.5">
              <button
                disabled={ladderPage <= 1}
                onClick={() => setLadderPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded bg-slate-800 text-slate-300 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                onClick={() => setLadderPage((p) => Math.min(10, p + 1))}
                className="px-2.5 py-1 rounded bg-slate-800 text-slate-300"
              >
                Próxima
              </button>
            </div>
          </div>
          <div className="divide-y divide-slate-800/70">
            {((ladder?.linhas as Record<string, unknown>[]) || []).map((row, idx) => (
              <div key={idx} className="py-2 flex items-center justify-between">
                <span className="text-white">
                  <b className="font-mono text-amber-300 mr-2">#{Number(row.posicao || idx + 1)}</b>
                  {String(row.nick || "?")}
                </span>
                <span className="font-mono text-slate-300">
                  {fmtCompact(Number(row.pontos || 0))} PR
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly Pool */}
      {sub === "monthly" && (
        <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3 text-xs">
          <div className="font-semibold text-white flex items-center gap-2">
            <Crown className="w-4 h-4 text-fuchsia-400" /> Top 2.000 Mensal — Pool de Gemas
          </div>
          {monthly ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl bg-[#0b0e1b] p-3 border border-slate-800">
                <div className="text-slate-400">Mês</div>
                <div className="text-sm font-bold text-white">{String(monthly.mes || "Atual")}</div>
              </div>
              <div className="rounded-xl bg-[#0b0e1b] p-3 border border-slate-800">
                <div className="text-slate-400">Pool de Gemas</div>
                <div className="text-sm font-bold text-fuchsia-300 font-mono">
                  {fmtCompact(Number(monthly.pool || 0))}
                </div>
              </div>
              <div className="rounded-xl bg-[#0b0e1b] p-3 border border-slate-800">
                <div className="text-slate-400">Partidas mín.</div>
                <div className="text-sm font-bold text-white font-mono">
                  {Number(monthly.partidasMin || 0)}
                </div>
              </div>
              <div className="rounded-xl bg-[#0b0e1b] p-3 border border-slate-800">
                <div className="text-slate-400">Minha posição</div>
                <div className="text-sm font-bold text-amber-300 font-mono">
                  #{Number((monthly.eu as Record<string, unknown>)?.posicao || 0) || "—"}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-slate-400">Carregando ranking mensal...</div>
          )}
        </div>
      )}
    </div>
  );
}
