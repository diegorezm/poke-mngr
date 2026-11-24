import { useEffect, useState } from "react";
import { Gift, CheckCircle2, Clock, Crown } from "lucide-react";
import { AccountTelemetry, fmtDuration } from "../lib/types";
import { api } from "../lib/api";
import { PASS_TRACK, computePassState, prizeView } from "../lib/gameData";

export function PassView({
  accounts,
  serverTimeMs,
  onToast,
}: {
  accounts: AccountTelemetry[];
  serverTimeMs: number;
  onToast: (msg: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<number>(0);
  const [now, setNow] = useState<number>(serverTimeMs || Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const acc = accounts.find((a) => a.id === selectedId) || accounts[0];
  const claimableCount = accounts.filter((a) => a.state === "ONLINE" && a.pass.canClaim).length;

  const handleClaim = async (id: number, nick: string) => {
    setBusy(true);
    try {
      await api.claimPass(id);
      onToast(`${nick}: passe diário resgatado!`);
    } catch (e) {
      onToast(`Erro: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleClaimAll = async () => {
    setBusy(true);
    try {
      const n = await api.claimAllPasses();
      onToast(`${n} conta(s) resgataram o passe diário!`);
    } catch (e) {
      onToast(`Erro: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (!acc) {
    return (
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-10 text-center text-sm text-slate-400 max-w-lg mx-auto mt-10">
        Adicione uma conta para acompanhar e resgatar o Passe de Batalha.
      </div>
    );
  }

  const st = computePassState(acc.pass.raw, now + (acc.serverOffsetMs || 0));
  const untilResetSec = Math.max(0, Math.floor((st.viradaEm - (now + (acc.serverOffsetMs || 0))) / 1000));

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border inline-flex items-center gap-1.5 ${
                acc.id === a.id
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-[#0b0e1b] text-slate-300 border-slate-800"
              }`}
            >
              {a.nick}
              {a.pass.canClaim && a.state === "ONLINE" && (
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-400 inline-flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-sky-400" />
            Vira em <b className="font-mono text-white">{fmtDuration(untilResetSec)}</b>
          </span>
          {claimableCount > 0 && (
            <button
              disabled={busy}
              onClick={handleClaimAll}
              className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold inline-flex items-center gap-1.5"
            >
              <Gift className="w-4 h-4" /> Resgatar Todas ({claimableCount})
            </button>
          )}
        </div>
      </div>

      {/* Selected account pass status */}
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-base text-white">{acc.nick}</h3>
            <span className="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
              Dia {st.degrau} / 30
            </span>
            {st.vipAtivo && (
              <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 inline-flex items-center gap-1">
                <Crown className="w-3.5 h-3.5" /> VIP Ativo
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400">
            Ciclos completos: <b>{st.ciclos}</b> · Total resgatado: <b>{st.total}</b> dias
          </div>
        </div>

        <button
          disabled={busy || !acc.pass.canClaim || acc.state !== "ONLINE"}
          onClick={() => handleClaim(acc.id, acc.nick)}
          className={`px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 ${
            acc.pass.canClaim && acc.state === "ONLINE"
              ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
              : "bg-slate-800 text-slate-500 cursor-not-allowed"
          }`}
        >
          {acc.pass.canClaim ? (
            <>
              <Gift className="w-4 h-4" /> Resgatar Dia {st.degrau}
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" /> Já resgatado hoje
            </>
          )}
        </button>
      </div>

      {/* 30-day Track Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {PASS_TRACK.map((step) => {
          const isDone = step.dia < st.degrau || (step.dia === st.degrau && st.jaPegouHoje);
          const isToday = step.dia === st.degrau && !st.jaPegouHoje;
          return (
            <div
              key={step.dia}
              className={`rounded-xl border p-3 space-y-2 ${
                isToday
                  ? "bg-amber-500/10 border-amber-400/60"
                  : isDone
                  ? "bg-emerald-500/5 border-emerald-500/25 opacity-80"
                  : step.bau
                  ? "bg-[#15182c] border-purple-500/35"
                  : "bg-[#111525] border-slate-800"
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-white">
                  Dia {step.dia} {step.bau ? "🎁" : ""}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  {isDone ? "Resgatado" : isToday ? "Hoje" : step.tier}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg bg-[#0b0e1b] p-2 space-y-1 border border-slate-800/70">
                  <div className="text-[10px] text-slate-500 uppercase">Grátis</div>
                  {step.free.map((p, i) => {
                    const pv = prizeView(p);
                    return (
                      <div key={i} className="flex items-center gap-1.5" title={pv.name}>
                        <img src={pv.icon} className="w-4 h-4 object-contain pixelated" alt="" />
                        <span className="text-slate-200 font-mono">{pv.short}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="rounded-lg bg-[#161224] p-2 space-y-1 border border-amber-500/20">
                  <div className="text-[10px] text-amber-400/80 uppercase">VIP</div>
                  {step.vip.map((p, i) => {
                    const pv = prizeView(p);
                    return (
                      <div key={i} className="flex items-center gap-1.5" title={pv.name}>
                        <img src={pv.icon} className="w-4 h-4 object-contain pixelated" alt="" />
                        <span className="text-amber-200 font-mono">{pv.short}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
