import { useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
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
  Globe,
} from "lucide-react";
import {
  AccountTelemetry,
  BALL_OPTIONS,
  CardStyle,
  POTION_OPTIONS,
  ballIcon,
  fmtCompact,
  fmtDuration,
  potionIcon,
} from "../lib/types";
import { api } from "../lib/api";
import { ItemSprite, PokemonSprite } from "./PokemonSprite";
import { DsBar } from "./DsPrimitives";

const ACCENT_BARS = [
  "bg-[#dc382c]",
  "bg-[#2563eb]",
  "bg-[#16a34a]",
  "bg-[#d97706]",
] as const;

const STATE_META: Record<string, { label: string; dot: string; pill: string }> = {
  ONLINE: {
    label: "Online",
    dot: "bg-[#22c55e] animate-ds-led",
    pill: "bg-emerald-500/15 text-[var(--ink-accent-green)] border-emerald-600/30",
  },
  CONNECTING: {
    label: "Conectando",
    dot: "bg-[#f59e0b] animate-pulse",
    pill: "bg-amber-500/15 text-[var(--ink-accent-amber)] border-amber-600/30",
  },
  AUTHENTICATING: {
    label: "Autenticando",
    dot: "bg-[#3b82f6] animate-pulse",
    pill: "bg-blue-500/15 text-[var(--ink-accent-sky)] border-blue-600/30",
  },
  PAUSED_COOLDOWN: {
    label: "Cooldown 4001",
    dot: "bg-[#f97316]",
    pill: "bg-orange-500/15 text-[var(--ink-accent-amber)] border-orange-600/30",
  },
  BLOCKED: {
    label: "Ação Necessária",
    dot: "bg-[#ef4444]",
    pill: "bg-red-500/15 text-[var(--ink-accent-rose)] border-red-600/30",
  },
  DISCONNECTED: {
    label: "Offline",
    dot: "bg-slate-400",
    pill: "bg-slate-500/15 text-[var(--ink-muted)] border-slate-500/30",
  },
};

export function AccountCard({
  acc,
  cardIndex = 0,
  bridgePort,
  serverTimeMs,
  cardStyle,
  onToast,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  acc: AccountTelemetry;
  cardIndex?: number;
  bridgePort: number;
  serverTimeMs: number;
  cardStyle: CardStyle;
  onToast: (msg: string) => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
}) {
  const [view, setView] = useState<"summary" | "session">("summary");
  const [busy, setBusy] = useState(false);

  const meta = STATE_META[acc.state] || STATE_META.DISCONNECTED;
  const accentBar = ACCENT_BARS[cardIndex % ACCENT_BARS.length];
  const trainerPct =
    acc.xpNext > 0 ? Math.min(100, Math.max(0, (acc.xp / acc.xpNext) * 100)) : 0;
  const pk = acc.activePokemon;
  const pkHpPct =
    pk && pk.maxHp > 0 ? Math.min(100, Math.max(0, (pk.hp / pk.maxHp) * 100)) : 0;
  const pkXpPct =
    pk && pk.xpNext > 0 ? Math.min(100, Math.max(0, (pk.xp / pk.xpNext) * 100)) : 0;

  const handleToggleGame = async () => {
    const isAttached = acc.bridgeAttached;
    try {
      if (isAttached) {
        await api.closeGameWindow(acc.id);
      } else {
        await api.openGameWindow(acc.id);
      }
    } catch (e) {
      onToast(`Erro ao abrir janela do jogo: ${String(e)}`);
    }
  };

  const handleEquip = async (kind: "potion" | "ball", id: number, close: () => void) => {
    close();
    setBusy(true);
    const nick = acc.nick;
    try {
      await api.equipItem(acc.id, kind, id);
      onToast(`${nick}: equipado com sucesso!`);
    } catch (e) {
      onToast(`Erro ao equipar: ${String(e)}`);
    }
    setBusy(false);
  };

  const handleClaimPass = async () => {
    const nick = acc.nick;
    try {
      await api.claimPass(acc.id);
      onToast(`${nick}: passe diário resgatado!`);
    } catch (e) {
      onToast(`Erro no passe: ${String(e)}`);
    }
  };

  const handleRestart = async () => {
    const nick = acc.nick;
    try {
      await api.restartAccount(acc.id);
      onToast(`${nick}: reconectando...`);
    } catch (e) {
      onToast(`Erro ao reiniciar: ${String(e)}`);
    }
  };

  const handleResetSession = async () => {
    const nick = acc.nick;
    try {
      await api.resetSession(acc.id);
      onToast(`${nick}: sessão zerada!`);
    } catch (e) {
      onToast(`Erro: ${String(e)}`);
    }
  };

  const sessionElapsed =
    acc.session.startedAt > 0
      ? Math.max(0, Math.floor(serverTimeMs / 1000) - acc.session.startedAt)
      : 0;

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{ animationDelay: `${Math.min(cardIndex, 6) * 40}ms` }}
      className="hw-card animate-ds-card flex flex-col"
    >
      {/* Sleek 4px Trainer Color Bar */}
      <div className={`h-1 w-full ${accentBar}`} />

      <div className="p-4 flex-1 flex flex-col gap-3.5">
        {/* Header: Sprite + Trainer Info + Action Buttons */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="group px-stage w-16 h-16 flex items-center justify-center relative shrink-0">
              <div className="group-hover:animate-ds-idle">
                <PokemonSprite
                  looktype={pk?.looktype}
                  bridgePort={bridgePort}
                  size={56}
                  shiny={pk?.shiny}
                />
              </div>
              <span
                className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-[var(--panel-bg)] ${meta.dot}`}
              />
              {pk?.shiny && (
                <span className="animate-ds-shiny absolute -top-1 -right-1 text-[11px] pointer-events-none">
                  ✨
                </span>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="font-bold text-[15px] text-[var(--ink)] truncate">
                  {acc.nick}
                </h3>
                <span className="font-mono-num text-[11px] font-bold bg-[#1b1f26] text-[#fde047] px-1.5 py-0.5 rounded">
                  Lv.{acc.level || 0}
                </span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border ${meta.pill}`}
                >
                  {meta.label}
                </span>
                {acc.bridgeAttached && (
                  <span className="font-mono-num text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-500/15 text-[var(--ink-accent-sky)] border border-blue-500/30">
                    BRIDGE
                  </span>
                )}
              </div>

              <div className="text-xs text-[var(--ink-muted)] font-medium flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="truncate font-semibold text-[var(--ink)]">
                  {pk ? `${pk.name} Lv.${pk.level}` : "Sem Pokémon ativo"}
                </span>
                <span>·</span>
                <span className="truncate">
                  {acc.hunt.name || acc.hunt.slug || "Sem hunt ativa"}
                </span>
                {acc.hunt.isOutland && acc.hunt.outlandTier > 0 && (
                  <span className="font-mono-num text-[10px] font-bold px-1.5 py-0.2 rounded bg-purple-600 text-white">
                    T{acc.hunt.outlandTier}
                  </span>
                )}
                {acc.proxyLabel && (
                  <span
                    className="inline-flex items-center gap-0.5 text-[11px] text-[var(--ink-subtle)]"
                    title={`Proxy: ${acc.proxyLabel} (IP: ${acc.exitIp})`}
                  >
                    <Globe className="w-3 h-3" /> {acc.exitIp}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Tactile Hardware Action Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            {acc.pass.canClaim && acc.state === "ONLINE" && (
              <button
                onClick={handleClaimPass}
                title="Resgatar Passe Diário"
                className="ds-btn ds-btn-orange ds-btn-sm !px-2"
              >
                <Gift className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={handleToggleGame}
              title={
                acc.bridgeAttached
                  ? "Fechar janela do jogo (continua farmando na bandeja)"
                  : "Abrir visualização ao vivo do personagem (Bridge WS)"
              }
              className={`ds-btn ds-btn-sm ${
                acc.bridgeAttached ? "ds-btn-red" : "ds-btn-blue"
              }`}
            >
              {acc.bridgeAttached ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" /> Fechar
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
              className="ds-btn ds-btn-slate ds-btn-sm !px-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Warning Banner */}
        {(acc.block || acc.lastReason) && acc.state !== "ONLINE" && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/35 px-3 py-2 text-xs text-[var(--ink-accent-rose)] font-semibold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span className="truncate">{acc.block?.detail || acc.lastReason}</span>
          </div>
        )}

        {/* HP & EXP Bars */}
        <div className="space-y-1.5">
          {pk && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-semibold">
                <span className="text-[var(--ink-muted)]">HP {pk.name}</span>
                <span className="font-mono-num text-[var(--ink)]">
                  {pk.hp} / {pk.maxHp}
                </span>
              </div>
              <DsBar pct={pkHpPct} tone="hp" height={7} />
            </div>
          )}

          {cardStyle === "padrao" && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-semibold">
                <span className="text-[var(--ink-muted)]">EXP Treinador</span>
                <span className="font-mono-num text-[var(--ink-accent-sky)]">
                  {trainerPct.toFixed(1)}%
                </span>
              </div>
              <DsBar pct={trainerPct} tone="exp" height={6} />
            </div>
          )}
        </div>

        {/* View Switcher (Resumo / Sessão) + Wallet & Timer */}
        <div className="flex items-center justify-between gap-2 flex-wrap border-y border-[var(--border-soft)] py-2 text-xs">
          <div className="inline-flex items-center gap-1 bg-[var(--panel-alt)] p-0.5 rounded-lg border border-[var(--border-mid)]">
            <button
              onClick={() => setView("summary")}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                view === "summary"
                  ? "bg-[var(--dex-red)] text-white shadow-sm"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              Resumo
            </button>
            <button
              onClick={() => setView("session")}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition cursor-pointer ${
                view === "session"
                  ? "bg-[var(--dex-red)] text-white shadow-sm"
                  : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
              }`}
            >
              Sessão
            </button>
          </div>

          <div className="flex items-center gap-3 font-mono-num text-xs font-bold">
            <span
              className="inline-flex items-center gap-1 text-[var(--ink-muted)] font-semibold"
              title="Duração da hunt atual"
            >
              <Clock className="w-3.5 h-3.5" />
              {fmtDuration(acc.hunt.elapsedSec)}
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--ink-accent-amber)]">
              <Coins className="w-3.5 h-3.5" />
              {fmtCompact(acc.gold)}
            </span>
            <span className="inline-flex items-center gap-1 text-[var(--ink-accent-fuchsia)]">
              <Gem className="w-3.5 h-3.5" />
              {fmtCompact(acc.orbs)}
            </span>
          </div>
        </div>

        {view === "summary" ? (
          <>
            {/* Alternate cardStyle visualizations */}
            {cardStyle === "medalhao" && (
              <div className="px-inset p-3 flex items-center gap-3.5">
                <div className="relative w-14 h-14 shrink-0 flex items-center justify-center">
                  <svg className="w-14 h-14 -rotate-90" viewBox="0 0 64 64">
                    <circle cx="32" cy="32" r="28" fill="none" stroke="var(--panel-deep)" strokeWidth="5" />
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill="none"
                      stroke="#d97706"
                      strokeWidth="5"
                      strokeDasharray={`${(trainerPct / 100) * 176} 176`}
                      strokeLinecap="round"
                    />
                    <circle cx="32" cy="32" r="20" fill="none" stroke="var(--panel-deep)" strokeWidth="4" />
                    <circle
                      cx="32"
                      cy="32"
                      r="20"
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="4"
                      strokeDasharray={`${(pkXpPct / 100) * 126} 126`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <span className="absolute font-mono-num text-[10px] font-bold text-[var(--ink)]">
                    {trainerPct.toFixed(0)}%
                  </span>
                </div>
                <div className="flex-1 min-w-0 text-xs space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span className="text-[var(--ink-muted)]">Treinador Lv.{acc.level}</span>
                    <span className="font-mono-num text-[var(--ink-accent-amber)]">
                      {trainerPct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span className="text-[var(--ink-muted)] truncate">
                      {pk ? `${pk.name} Lv.${pk.level}` : "Sem ativo"}
                    </span>
                    <span className="font-mono-num text-[var(--ink-accent-sky)]">
                      {pkXpPct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            )}

            {cardStyle === "corrida" && (
              <div className="px-inset p-3 space-y-2 text-xs">
                <div className="flex justify-between font-semibold">
                  <span className="text-[var(--ink-accent-amber)]">👑 Treinador Lv.{acc.level}</span>
                  <span className="font-mono-num">{trainerPct.toFixed(1)}%</span>
                </div>
                <DsBar pct={trainerPct} tone="gold" height={7} />
                <div className="flex justify-between font-semibold pt-0.5">
                  <span className="text-[var(--ink-accent-sky)] truncate">
                    ⚡ {pk ? `${pk.name} Lv.${pk.level}` : "Pokémon"}
                  </span>
                  <span className="font-mono-num">{pkXpPct.toFixed(1)}%</span>
                </div>
                <DsBar pct={pkXpPct} tone="exp" height={7} />
              </div>
            )}

            {cardStyle === "versus" && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="px-inset p-2.5 space-y-1">
                  <div className="text-[11px] font-semibold text-[var(--ink-muted)]">Treinador</div>
                  <div className="font-mono-num text-base font-bold text-[var(--ink-accent-amber)]">
                    {trainerPct.toFixed(1)}%
                  </div>
                  <DsBar pct={trainerPct} tone="gold" height={6} />
                </div>
                <div className="px-inset p-2.5 space-y-1">
                  <div className="text-[11px] font-semibold text-[var(--ink-muted)] truncate">
                    {pk ? pk.name : "Pokémon"}
                  </div>
                  <div className="font-mono-num text-base font-bold text-[var(--ink-accent-sky)]">
                    {pkXpPct.toFixed(1)}%
                  </div>
                  <DsBar pct={pkXpPct} tone="exp" height={6} />
                </div>
              </div>
            )}

            {/* 3 Metric Tiles */}
            <div className="grid grid-cols-3 gap-2">
              <div className="px-inset px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                  XP / hora
                </div>
                <div className="font-mono-num text-[14px] font-bold text-[var(--ink-accent-sky)] mt-0.5">
                  {fmtCompact(acc.hunt.xpPerHour)}
                </div>
              </div>
              <div className="px-inset px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                  Ouro / hora
                </div>
                <div className="font-mono-num text-[14px] font-bold text-[var(--ink-accent-amber)] mt-0.5">
                  {fmtCompact(acc.hunt.goldPerHour)}
                </div>
              </div>
              <div className="px-inset px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)] flex items-center gap-1">
                  <Swords className="w-3 h-3" /> Kills / h
                </div>
                <div className="font-mono-num text-[14px] font-bold text-[var(--ink-accent-green)] mt-0.5">
                  {fmtCompact(acc.hunt.killsPerHour)}
                </div>
              </div>
            </div>

            {/* Hardware Keycap Equipped Slots (Headless UI Popover) */}
            <div className="grid grid-cols-2 gap-2">
              <Popover className="relative">
                {({ close }) => (
                  <>
                    <PopoverButton
                      disabled={busy || acc.state !== "ONLINE"}
                      className="equip-keycap w-full flex items-center justify-between px-3 py-2 text-left cursor-pointer disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ItemSprite
                          icon={potionIcon(acc.equippedPotion?.id)}
                          size={22}
                          alt={acc.equippedPotion?.name || "Poção"}
                        />
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold text-[var(--ink-muted)] leading-none">
                            Poção
                          </div>
                          <div className="text-xs font-bold text-[var(--ink)] truncate mt-0.5">
                            {acc.equippedPotion?.name || "Nenhuma"}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono-num text-xs font-bold text-[var(--ink-muted)] shrink-0">
                        {fmtCompact(acc.equippedPotion?.stock)}
                      </span>
                    </PopoverButton>

                    <PopoverPanel
                      transition
                      className="absolute left-0 bottom-full mb-2 z-30 w-64 px-box p-2 grid grid-cols-2 gap-1.5 transition duration-150 ease-out data-[closed]:opacity-0 data-[closed]:translate-y-1 data-[closed]:scale-95"
                    >
                      {POTION_OPTIONS.map((opt) => {
                        const selected = acc.equippedPotion?.id === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => handleEquip("potion", opt.id, close)}
                            className={`px-2 py-1.5 rounded-lg text-xs text-left flex items-center gap-2 border transition cursor-pointer ${
                              selected
                                ? "bg-[var(--row-active-bg)] border-[var(--row-active-border)] text-[var(--row-active-ink)] font-bold"
                                : "bg-[var(--panel-alt)] border-[var(--border-mid)] text-[var(--ink)] hover:border-[var(--border-dark)]"
                            }`}
                          >
                            <ItemSprite icon={opt.icon} size={20} alt={opt.name} />
                            <span className="font-semibold truncate">{opt.name}</span>
                          </button>
                        );
                      })}
                    </PopoverPanel>
                  </>
                )}
              </Popover>

              <Popover className="relative">
                {({ close }) => (
                  <>
                    <PopoverButton
                      disabled={busy || acc.state !== "ONLINE"}
                      className="equip-keycap w-full flex items-center justify-between px-3 py-2 text-left cursor-pointer disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <ItemSprite
                          icon={ballIcon(acc.equippedBall?.id)}
                          size={22}
                          alt={acc.equippedBall?.name || "Pokébola"}
                        />
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold text-[var(--ink-muted)] leading-none">
                            Pokébola
                          </div>
                          <div className="text-xs font-bold text-[var(--ink)] truncate mt-0.5">
                            {acc.equippedBall?.name || "Nenhuma"}
                          </div>
                        </div>
                      </div>
                      <span className="font-mono-num text-xs font-bold text-[var(--ink-muted)] shrink-0">
                        {fmtCompact(acc.equippedBall?.stock)}
                      </span>
                    </PopoverButton>

                    <PopoverPanel
                      transition
                      className="absolute right-0 bottom-full mb-2 z-30 w-64 px-box p-2 grid grid-cols-2 gap-1.5 transition duration-150 ease-out data-[closed]:opacity-0 data-[closed]:translate-y-1 data-[closed]:scale-95"
                    >
                      {BALL_OPTIONS.map((opt) => {
                        const selected = acc.equippedBall?.id === opt.id;
                        return (
                          <button
                            key={opt.id}
                            onClick={() => handleEquip("ball", opt.id, close)}
                            className={`px-2 py-1.5 rounded-lg text-xs text-left flex items-center gap-2 border transition cursor-pointer ${
                              selected
                                ? "bg-[var(--row-active-bg)] border-[var(--row-active-border)] text-[var(--row-active-ink)] font-bold"
                                : "bg-[var(--panel-alt)] border-[var(--border-mid)] text-[var(--ink)] hover:border-[var(--border-dark)]"
                            }`}
                          >
                            <ItemSprite icon={opt.icon} size={20} alt={opt.name} />
                            <span className="font-semibold truncate">{opt.name}</span>
                          </button>
                        );
                      })}
                    </PopoverPanel>
                  </>
                )}
              </Popover>
            </div>
          </>
        ) : (
          /* Session Stats View */
          <div className="space-y-2.5 animate-ds-tab">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="px-inset px-3 py-2 flex justify-between items-center">
                <span className="text-[var(--ink-muted)] font-semibold">Boss Token</span>
                <span className="font-mono-num font-bold text-[var(--ink-accent-amber)]">
                  +{acc.session.gained.boss || 0}
                </span>
              </div>
              <div className="px-inset px-3 py-2 flex justify-between items-center">
                <span className="text-[var(--ink-muted)] font-semibold">Frag. Chave</span>
                <span className="font-mono-num font-bold text-[var(--ink-accent-sky)]">
                  +{acc.session.gained.key || 0}
                </span>
              </div>
              <div className="px-inset px-3 py-2 flex justify-between items-center">
                <span className="text-[var(--ink-muted)] font-semibold">Shiny Stone</span>
                <span className="font-mono-num font-bold text-[var(--ink-accent-fuchsia)]">
                  +{acc.session.gained.shinyStone || 0}
                </span>
              </div>
              <div className="px-inset px-3 py-2 flex justify-between items-center">
                <span className="text-[var(--ink-muted)] font-semibold">Frag. Bike</span>
                <span className="font-mono-num font-bold text-[var(--ink-accent-green)]">
                  +{acc.session.gained.bike || 0}
                </span>
              </div>
            </div>

            <div className="px-inset px-3 py-2 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-[var(--ink)]">
                <Sparkles className="w-4 h-4 text-[#d97706]" />
                <span>
                  Shinies: <b>{acc.session.shiniesSeen}</b> vistos /{" "}
                  <b className="text-[var(--ink-accent-green)]">{acc.session.shiniesCaught}</b>{" "}
                  capturados
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono-num text-[11px] text-[var(--ink-muted)]">
                  {fmtDuration(sessionElapsed)}
                </span>
                <button
                  onClick={handleResetSession}
                  title="Zerar contadores da sessão"
                  className="ds-btn ds-btn-slate ds-btn-sm !px-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Subtle Hardware Drops Footer Strip */}
      <div className="bg-[var(--panel-alt)] border-t border-[var(--border-mid)] px-4 py-2 flex items-center justify-between gap-2 flex-wrap text-[11px]">
        <span className="font-mono-num text-[10px] font-bold uppercase tracking-wider text-[var(--ink-subtle)]">
          Drops da sessão
        </span>
        <div className="flex items-center gap-3 font-mono-num font-bold text-[var(--ink-muted)] flex-wrap">
          <span title="Boss Token">🏆 {acc.session.gained.boss || 0}</span>
          <span title="Fragmentos de Chave">🔑 {acc.session.gained.key || 0}</span>
          <span title="Shiny Stone">💎 {acc.session.gained.shinyStone || 0}</span>
          <span title="Shinies capturados / vistos" className="text-[var(--ink-accent-amber)]">
            ✨ {acc.session.shiniesCaught}/{acc.session.shiniesSeen}
          </span>
        </div>
      </div>
    </article>
  );
}
