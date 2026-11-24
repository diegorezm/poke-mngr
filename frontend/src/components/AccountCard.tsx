import { useState } from "react";
import {
  Eye,
  EyeOff,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Gift,
  Coins,
  Gem,
  Swords,
  ShieldAlert,
  Clock,
  FlaskConical,
  CircleDot,
  Globe,
} from "lucide-react";
import {
  AccountTelemetry,
  BALL_OPTIONS,
  CardStyle,
  POTION_OPTIONS,
  fmtCompact,
  fmtDuration,
} from "../lib/types";
import { api } from "../lib/api";
import { PokemonSprite } from "./PokemonSprite";

const STATE_META: Record<
  string,
  { label: string; dot: string; badge: string }
> = {
  ONLINE: {
    label: "Online",
    dot: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  },
  CONNECTING: {
    label: "Conectando",
    dot: "bg-amber-400 animate-pulse",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  AUTHENTICATING: {
    label: "Autenticando",
    dot: "bg-sky-400 animate-pulse",
    badge: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
  PAUSED_COOLDOWN: {
    label: "Cooldown (4001)",
    dot: "bg-orange-400",
    badge: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  },
  BLOCKED: {
    label: "Ação Necessária",
    dot: "bg-rose-500",
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  },
  DISCONNECTED: {
    label: "Offline",
    dot: "bg-slate-500",
    badge: "bg-slate-700/40 text-slate-400 border-slate-600/40",
  },
};

export function AccountCard({
  acc,
  bridgePort,
  cardStyle,
  onToast,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  acc: AccountTelemetry;
  bridgePort: number;
  cardStyle: CardStyle;
  onToast: (msg: string) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  const [view, setView] = useState<"summary" | "session">("summary");
  const [equipMenu, setEquipMenu] = useState<"potion" | "ball" | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = STATE_META[acc.state] || STATE_META.DISCONNECTED;
  const trainerPct =
    acc.xpNext > 0 ? Math.min(100, Math.max(0, (acc.xp / acc.xpNext) * 100)) : 0;
  const pk = acc.activePokemon;
  const pkHpPct =
    pk && pk.maxHp > 0 ? Math.min(100, Math.max(0, (pk.hp / pk.maxHp) * 100)) : 0;
  const pkXpPct =
    pk && pk.xpNext > 0 ? Math.min(100, Math.max(0, (pk.xp / pk.xpNext) * 100)) : 0;

  const handleToggleGame = async () => {
    try {
      if (acc.bridgeAttached) {
        await api.closeGameWindow(acc.id);
      } else {
        await api.openGameWindow(acc.id);
      }
    } catch (e) {
      onToast(`Erro ao abrir janela do jogo: ${String(e)}`);
    }
  };

  const handleEquip = async (kind: "potion" | "ball", id: number) => {
    setEquipMenu(null);
    setBusy(true);
    try {
      await api.equipItem(acc.id, kind, id);
      onToast(`${acc.nick}: equipado com sucesso`);
    } catch (e) {
      onToast(`Erro ao equipar: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClaimPass = async () => {
    try {
      await api.claimPass(acc.id);
      onToast(`${acc.nick}: passe diário resgatado!`);
    } catch (e) {
      onToast(`Erro no passe: ${String(e)}`);
    }
  };

  const handleRestart = async () => {
    try {
      await api.restartAccount(acc.id);
      onToast(`${acc.nick}: reconectando...`);
    } catch (e) {
      onToast(`Erro ao reiniciar: ${String(e)}`);
    }
  };

  const handleResetSession = async () => {
    try {
      await api.resetSession(acc.id);
      onToast(`${acc.nick}: sessão zerada`);
    } catch (e) {
      onToast(`Erro: ${String(e)}`);
    }
  };

  const sessionElapsed =
    acc.session.startedAt > 0
      ? Math.max(0, Math.floor(Date.now() / 1000) - acc.session.startedAt)
      : 0;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="relative rounded-2xl bg-[#111525] border border-slate-800/90 shadow-lg hover:border-slate-700/90 transition-colors p-4 flex flex-col gap-3.5"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative">
            <PokemonSprite
              looktype={pk?.looktype}
              bridgePort={bridgePort}
              size={52}
              shiny={pk?.shiny}
              className="rounded-xl bg-[#0a0d18] border border-slate-800"
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full ring-2 ring-[#111525] ${meta.dot}`}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base text-white truncate">
                {acc.nick}
              </h3>
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-800 text-amber-300">
                Lv {acc.level || 0}
              </span>
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${meta.badge}`}
              >
                {meta.label}
              </span>
              {acc.bridgeAttached && (
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Bridge Ativo
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5 truncate">
              <span className="truncate">
                {acc.hunt.name || acc.hunt.slug || "Sem hunt ativa"}
              </span>
              {acc.hunt.isOutland && acc.hunt.outlandTier > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300">
                  T{acc.hunt.outlandTier}
                </span>
              )}
              {acc.proxyLabel && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] text-slate-500"
                  title={`Proxy: ${acc.proxyLabel} (IP: ${acc.exitIp})`}
                >
                  <Globe className="w-3 h-3" /> {acc.exitIp}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          {acc.pass.canClaim && acc.state === "ONLINE" && (
            <button
              onClick={handleClaimPass}
              title="Resgatar Passe Diário"
              className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 transition"
            >
              <Gift className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={handleToggleGame}
            title={
              acc.bridgeAttached
                ? "Fechar janela do jogo (continua farmando na bandeja)"
                : "Abrir visualização ao vivo do personagem (Bridge WS)"
            }
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 border transition ${
              acc.bridgeAttached
                ? "bg-indigo-500/25 text-indigo-200 border-indigo-500/40 hover:bg-indigo-500/35"
                : "bg-slate-800/90 text-slate-200 border-slate-700 hover:bg-slate-700"
            }`}
          >
            {acc.bridgeAttached ? (
              <>
                <EyeOff className="w-3.5 h-3.5" /> Fechar Jogo
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" /> Ver Jogo
              </>
            )}
          </button>
          <button
            onClick={handleRestart}
            title="Reconectar conta"
            className="p-1.5 rounded-lg bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-700 border border-slate-700/70 transition"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Warning banner for Blocked / Cooldown / Error */}
      {(acc.block || acc.lastReason) && acc.state !== "ONLINE" && (
        <div className="rounded-lg bg-rose-500/10 border border-rose-500/25 px-3 py-2 text-xs text-rose-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
          <span className="truncate">
            {acc.block?.detail || acc.lastReason}
          </span>
        </div>
      )}

      {/* View Switcher (Resumo / Sessão) */}
      <div className="flex items-center justify-between text-xs border-b border-slate-800/80 pb-2">
        <div className="flex items-center gap-1 bg-[#0a0d18] p-0.5 rounded-lg border border-slate-800">
          <button
            onClick={() => setView("summary")}
            className={`px-2.5 py-1 rounded-md font-medium transition ${
              view === "summary"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Resumo
          </button>
          <button
            onClick={() => setView("session")}
            className={`px-2.5 py-1 rounded-md font-medium transition ${
              view === "session"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Sessão
          </button>
        </div>
        <div className="flex items-center gap-3 text-slate-400">
          <span className="inline-flex items-center gap-1" title="Duração da hunt atual">
            <Clock className="w-3.5 h-3.5 text-slate-500" />
            {fmtDuration(acc.hunt.elapsedSec)}
          </span>
          <span className="inline-flex items-center gap-1 text-amber-300 font-medium">
            <Coins className="w-3.5 h-3.5" />
            {fmtCompact(acc.gold)}
          </span>
          <span className="inline-flex items-center gap-1 text-fuchsia-300 font-medium">
            <Gem className="w-3.5 h-3.5" />
            {fmtCompact(acc.orbs)}
          </span>
        </div>
      </div>

      {view === "summary" ? (
        <>
          {/* Style-specific XP / Progress Visualization */}
          {cardStyle === "medalhao" && (
            <div className="flex items-center gap-4 bg-[#0b0e1b] rounded-xl p-3 border border-slate-800/80">
              <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="28" fill="none" stroke="#1e293b" strokeWidth="4" />
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="4"
                    strokeDasharray={`${(trainerPct / 100) * 176} 176`}
                    strokeLinecap="round"
                  />
                  <circle cx="32" cy="32" r="21" fill="none" stroke="#1e293b" strokeWidth="3.5" />
                  <circle
                    cx="32"
                    cy="32"
                    r="21"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="3.5"
                    strokeDasharray={`${(pkXpPct / 100) * 132} 132`}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute text-[10px] font-mono text-amber-300">
                  {trainerPct.toFixed(0)}%
                </span>
              </div>
              <div className="flex-1 min-w-0 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Treinador Lv {acc.level}</span>
                  <span className="text-amber-300 font-mono">{trainerPct.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400 truncate">
                    {pk ? `${pk.name} Lv ${pk.level}` : "Sem ativo"}
                  </span>
                  <span className="text-sky-300 font-mono">{pkXpPct.toFixed(1)}%</span>
                </div>
                {pk && (
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 transition-all"
                      style={{ width: `${pkHpPct}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {cardStyle === "corrida" && (
            <div className="bg-[#0b0e1b] rounded-xl p-3 border border-slate-800/80 space-y-2 text-xs">
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-amber-300">👑 Treinador Lv {acc.level}</span>
                  <span className="font-mono text-slate-400">{trainerPct.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 rounded-full transition-all"
                    style={{ width: `${trainerPct}%` }}
                  />
                </div>
              </div>
              <div>
                <div className="flex justify-between mb-1">
                  <span className="text-sky-300 truncate">
                    ⚡ {pk ? `${pk.name} Lv ${pk.level}` : "Pokémon"}
                  </span>
                  <span className="font-mono text-slate-400">{pkXpPct.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-sky-500 to-cyan-300 rounded-full transition-all"
                    style={{ width: `${pkXpPct}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          {cardStyle === "versus" && (
            <div className="grid grid-cols-2 gap-2 bg-[#0b0e1b] rounded-xl p-3 border border-slate-800/80 text-xs">
              <div className="space-y-1">
                <div className="text-slate-400">Treinador</div>
                <div className="text-lg font-bold text-amber-300 font-mono">
                  {trainerPct.toFixed(1)}%
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-amber-400" style={{ width: `${trainerPct}%` }} />
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-slate-400 truncate">
                  {pk ? pk.name : "Pokémon"}
                </div>
                <div className="text-lg font-bold text-sky-300 font-mono">
                  {pkXpPct.toFixed(1)}%
                </div>
                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-sky-400" style={{ width: `${pkXpPct}%` }} />
                </div>
              </div>
            </div>
          )}

          {/* Metric Tiles Grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800/80 px-2.5 py-2">
              <div className="text-[11px] text-slate-400">XP / hora</div>
              <div className="text-sm font-semibold font-mono text-sky-300">
                {fmtCompact(acc.hunt.xpPerHour)}
              </div>
            </div>
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800/80 px-2.5 py-2">
              <div className="text-[11px] text-slate-400">Ouro / hora</div>
              <div className="text-sm font-semibold font-mono text-amber-300">
                {fmtCompact(acc.hunt.goldPerHour)}
              </div>
            </div>
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800/80 px-2.5 py-2">
              <div className="text-[11px] text-slate-400 flex items-center gap-1">
                <Swords className="w-3 h-3" /> Kills / h
              </div>
              <div className="text-sm font-semibold font-mono text-emerald-300">
                {fmtCompact(acc.hunt.killsPerHour)}
              </div>
            </div>
          </div>

          {/* Active Pokemon HP bar (for padrao style) */}
          {cardStyle === "padrao" && pk && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>
                  {pk.name} <span className="text-slate-500">Lv {pk.level}</span>
                </span>
                <span className="font-mono">
                  HP {pk.hp}/{pk.maxHp}
                </span>
              </div>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    pkHpPct > 50
                      ? "bg-emerald-400"
                      : pkHpPct > 25
                      ? "bg-amber-400"
                      : "bg-rose-500"
                  }`}
                  style={{ width: `${pkHpPct}%` }}
                />
              </div>
            </div>
          )}

          {/* Clickable Equipped Potion & Ball Tiles */}
          <div className="grid grid-cols-2 gap-2 relative">
            <button
              disabled={busy || acc.state !== "ONLINE"}
              onClick={() => setEquipMenu(equipMenu === "potion" ? null : "potion")}
              className="flex items-center justify-between rounded-xl bg-[#0b0e1b] hover:bg-slate-800/70 border border-slate-800 px-3 py-2 text-left transition disabled:opacity-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <FlaskConical className="w-4 h-4 text-rose-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-500">Poção</div>
                  <div className="text-xs font-medium text-slate-200 truncate">
                    {acc.equippedPotion?.name || "Nenhuma"}
                  </div>
                </div>
              </div>
              <span className="text-xs font-mono text-slate-300">
                {fmtCompact(acc.equippedPotion?.stock)}
              </span>
            </button>

            <button
              disabled={busy || acc.state !== "ONLINE"}
              onClick={() => setEquipMenu(equipMenu === "ball" ? null : "ball")}
              className="flex items-center justify-between rounded-xl bg-[#0b0e1b] hover:bg-slate-800/70 border border-slate-800 px-3 py-2 text-left transition disabled:opacity-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <CircleDot className="w-4 h-4 text-sky-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[10px] text-slate-500">Pokébola</div>
                  <div className="text-xs font-medium text-slate-200 truncate">
                    {acc.equippedBall?.name || "Nenhuma"}
                  </div>
                </div>
              </div>
              <span className="text-xs font-mono text-slate-300">
                {fmtCompact(acc.equippedBall?.stock)}
              </span>
            </button>

            {equipMenu && (
              <div className="absolute left-0 right-0 bottom-full mb-2 z-20 rounded-xl bg-[#161b30] border border-slate-700 shadow-2xl p-2 grid grid-cols-2 gap-1.5">
                {(equipMenu === "potion" ? POTION_OPTIONS : BALL_OPTIONS).map(
                  (opt) => (
                    <button
                      key={opt.id}
                      onClick={() => handleEquip(equipMenu, opt.id)}
                      className="px-2.5 py-1.5 rounded-lg text-xs text-left text-slate-200 hover:bg-indigo-500/25 hover:text-white transition"
                    >
                      {opt.name}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        /* Session Stats View */
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800/80 p-2.5 flex justify-between">
              <span className="text-slate-400">Boss Token</span>
              <span className="font-mono font-semibold text-amber-300">
                +{acc.session.gained.boss || 0}
              </span>
            </div>
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800/80 p-2.5 flex justify-between">
              <span className="text-slate-400">Frag. Chave</span>
              <span className="font-mono font-semibold text-sky-300">
                +{acc.session.gained.key || 0}
              </span>
            </div>
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800/80 p-2.5 flex justify-between">
              <span className="text-slate-400">Shiny Stone</span>
              <span className="font-mono font-semibold text-fuchsia-300">
                +{acc.session.gained.shinyStone || 0}
              </span>
            </div>
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800/80 p-2.5 flex justify-between">
              <span className="text-slate-400">Frag. Bike</span>
              <span className="font-mono font-semibold text-emerald-300">
                +{acc.session.gained.bike || 0}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl bg-[#0b0e1b] border border-slate-800/80 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>
                Shinies: <b>{acc.session.shiniesSeen}</b> vistos /{" "}
                <b className="text-emerald-300">{acc.session.shiniesCaught}</b>{" "}
                capturados
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500">{fmtDuration(sessionElapsed)}</span>
              <button
                onClick={handleResetSession}
                title="Zerar contadores da sessão"
                className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
