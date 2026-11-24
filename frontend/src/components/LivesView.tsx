import { useEffect, useState } from "react";
import {
  Radio,
  Play,
  Square,
  ExternalLink,
  RefreshCw,
  LogIn,
  Save,
  Gift,
} from "lucide-react";
import { LivesAccountConfig, LivesCentralState } from "../lib/types";
import { api } from "../lib/api";

function normalizeLivesState(st: LivesCentralState): LivesCentralState {
  return {
    ...st,
    channels: Array.isArray(st.channels) ? st.channels : [],
    accounts: Array.isArray(st.accounts) ? st.accounts : [],
    logs: Array.isArray(st.logs) ? st.logs : [],
  };
}

export function LivesView({ onToast }: { onToast: (msg: string) => void }) {
  const [state, setState] = useState<LivesCentralState | null>(null);
  const [selectedAccId, setSelectedAccId] = useState<number>(0);
  const [cfgDraft, setCfgDraft] = useState<LivesAccountConfig | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => {
    api
      .getLivesState()
      .then((st) => setState(normalizeLivesState(st)))
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const currentAcc =
    state?.accounts.find((a) => a.accountId === selectedAccId) || state?.accounts[0];

  useEffect(() => {
    if (currentAcc) {
      setCfgDraft(structuredClone(currentAcc.config));
    }
  }, [currentAcc?.accountId]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const st = await api.refreshLivesStatus();
      setState(normalizeLivesState(st));
      onToast("Status dos canais atualizado!");
    } catch (e) {
      onToast(`Erro ao atualizar canais: ${String(e)}`);
    }
    setRefreshing(false);
  };

  const handleSaveCfg = async () => {
    if (!currentAcc || !cfgDraft) return;
    try {
      await api.saveLivesConfig(currentAcc.accountId, cfgDraft);
      onToast(`Configurações de Lives salvas para ${currentAcc.nick}!`);
      load();
    } catch (e) {
      onToast(String(e));
    }
  };

  const handleStartSlot = async (
    accId: number,
    site: string,
    slot: number,
    channel: string,
    hidden: boolean
  ) => {
    if (!channel) {
      onToast("Nenhum canal ao vivo atribuído a esta vaga.");
      return;
    }
    const modeLabel = hidden ? "em segundo plano (mudo)" : "visível";
    try {
      await api.openLivePlayer(accId, site, slot, channel, hidden);
      onToast(`Player ${site}/${channel} iniciado ${modeLabel}`);
      load();
    } catch (e) {
      onToast(String(e));
    }
  };

  const handleStopSlot = async (accId: number, site: string, slot: number) => {
    await api.stopLivePlayer(accId, site, slot);
    load();
  };

  if (!state || state.accounts.length === 0) {
    return (
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-10 text-center text-sm text-slate-400 max-w-lg mx-auto mt-10">
        Adicione uma conta para gerenciar Lives da Twitch e da Kick.
      </div>
    );
  }

  const twitchChannels = state.channels.filter((c) => c.site === "twitch");
  const kickChannels = state.channels.filter((c) => c.site === "kick");

  return (
    <div className="space-y-4 max-w-6xl">
      {/* Header */}
      <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-wrap">
          {state.accounts.map((a) => (
            <button
              key={a.accountId}
              onClick={() => setSelectedAccId(a.accountId)}
              className={`px-3 py-1.5 rounded-xl font-medium border ${
                currentAcc?.accountId === a.accountId
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "bg-[#0b0e1b] text-slate-300 border-slate-800"
              }`}
            >
              {a.nick}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => api.openLiveLogin("twitch")}
            className="px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/30 inline-flex items-center gap-1.5"
          >
            <LogIn className="w-3.5 h-3.5" /> Entrar Twitch
          </button>
          <button
            onClick={() => api.openLiveLogin("kick")}
            className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-200 border border-emerald-500/30 inline-flex items-center gap-1.5"
          >
            <LogIn className="w-3.5 h-3.5" /> Entrar Kick
          </button>
          <button
            disabled={refreshing}
            onClick={handleRefresh}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
            title="Atualizar quem está ao vivo"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Slots & Controls for Selected Account */}
      {currentAcc && cfgDraft && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
          {/* 4 Slots (2 Twitch + 2 Kick) */}
          <div className="lg:col-span-2 rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm text-white flex items-center gap-2">
                <Radio className="w-4 h-4 text-purple-400" /> Vagas de Live — {currentAcc.nick}
              </h3>
              <span className="text-[11px] text-slate-400">
                Lista oficial: {state.officialFresh ? "Sincronizada via jogo" : "Aguardando conta online"}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {currentAcc.slots.map((s) => (
                <div
                  key={`${s.site}-${s.slot}`}
                  className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-3 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-bold uppercase text-[11px] ${
                        s.site === "twitch" ? "text-purple-300" : "text-emerald-300"
                      }`}
                    >
                      {s.site} · Vaga {s.slot}
                    </span>
                    {s.playing ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                        Tocando (mudo)
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500">Parado</span>
                    )}
                  </div>

                  <div className="text-sm font-semibold text-white">
                    {s.channel || "Nenhum canal ao vivo"}
                    {s.standIn && (
                      <span className="ml-1.5 text-[10px] text-amber-300 font-normal">
                        (cobertura)
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {s.playing ? (
                      <button
                        onClick={() => handleStopSlot(currentAcc.accountId, s.site, s.slot)}
                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/30 inline-flex items-center justify-center gap-1"
                      >
                        <Square className="w-3.5 h-3.5" /> Parar
                      </button>
                    ) : (
                      <>
                        <button
                          disabled={!s.channel}
                          onClick={() =>
                            handleStartSlot(currentAcc.accountId, s.site, s.slot, s.channel, true)
                          }
                          className="flex-1 px-2.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-40"
                        >
                          <Play className="w-3.5 h-3.5" /> Farmar Oculto
                        </button>
                        <button
                          disabled={!s.channel}
                          onClick={() =>
                            handleStartSlot(currentAcc.accountId, s.site, s.slot, s.channel, false)
                          }
                          title="Abrir player visível"
                          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                    {s.channel && (
                      <button
                        onClick={() => api.openLivePointsPage(s.site, s.channel)}
                        title="Abrir tela de Pontos / Resgate manual"
                        className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1"
                      >
                        <Gift className="w-3.5 h-3.5" /> Pontos
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Official Streamers Table */}
            <div className="pt-2 space-y-2">
              <div className="font-semibold text-slate-300">
                Streamers Oficiais Detectados ({state.channels.length})
              </div>
              <div className="max-h-52 overflow-y-auto divide-y divide-slate-800/70 rounded-xl bg-[#0b0e1b] border border-slate-800">
                {state.channels.length === 0 ? (
                  <div className="p-4 text-center text-slate-500">
                    Conecte uma conta ao PokéIdle para sincronizar automaticamente os streamers oficiais.
                  </div>
                ) : (
                  state.channels.map((ch) => (
                    <div
                      key={`${ch.site}-${ch.channel}`}
                      className="px-3 py-2 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            ch.live ? "bg-emerald-400" : "bg-slate-600"
                          }`}
                        />
                        <span
                          className={`text-[10px] uppercase font-bold ${
                            ch.site === "twitch" ? "text-purple-400" : "text-emerald-400"
                          }`}
                        >
                          {ch.site}
                        </span>
                        <span className="text-white font-medium">{ch.name || ch.channel}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400 font-mono">
                          {ch.live ? `${ch.viewers} assistindo` : "offline"}
                        </span>
                        <button
                          onClick={() => api.openLivePointsPage(ch.site, ch.channel)}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300"
                        >
                          Pontos
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Preferences + Slot Pinning */}
          <div className="rounded-2xl bg-[#111525] border border-slate-800 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-white">Preferências das Lives</div>
              <button
                onClick={handleSaveCfg}
                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold inline-flex items-center gap-1"
              >
                <Save className="w-3.5 h-3.5" /> Salvar
              </button>
            </div>

            <div className="space-y-2">
              <label className="block text-slate-400">Bônus preferido</label>
              <select
                value={cfgDraft.reward}
                onChange={(e) =>
                  setCfgDraft({
                    ...cfgDraft,
                    reward: e.target.value as "xp" | "capture" | "lure",
                  })
                }
                className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-white"
              >
                <option value="xp">XP Boost</option>
                <option value="capture">Captura Boost</option>
                <option value="lure">Shiny / Lure Boost</option>
              </select>

              <label className="block text-slate-400 pt-1">Twitch Vaga 1</label>
              <select
                value={cfgDraft.twitchSlot1}
                onChange={(e) => setCfgDraft({ ...cfgDraft, twitchSlot1: e.target.value })}
                className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-1.5 text-white"
              >
                <option value="">Automático</option>
                <option value="none">Desligada</option>
                {twitchChannels.map((c) => (
                  <option key={c.channel} value={c.channel}>
                    {c.channel} {c.live ? "🟢" : ""}
                  </option>
                ))}
              </select>

              <label className="block text-slate-400">Twitch Vaga 2</label>
              <select
                value={cfgDraft.twitchSlot2}
                onChange={(e) => setCfgDraft({ ...cfgDraft, twitchSlot2: e.target.value })}
                className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-1.5 text-white"
              >
                <option value="">Automático</option>
                <option value="none">Desligada</option>
                {twitchChannels.map((c) => (
                  <option key={c.channel} value={c.channel}>
                    {c.channel} {c.live ? "🟢" : ""}
                  </option>
                ))}
              </select>

              <label className="block text-slate-400 pt-1">Kick Vaga 1</label>
              <select
                value={cfgDraft.kickSlot1}
                onChange={(e) => setCfgDraft({ ...cfgDraft, kickSlot1: e.target.value })}
                className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-1.5 text-white"
              >
                <option value="">Automático</option>
                <option value="none">Desligada</option>
                {kickChannels.map((c) => (
                  <option key={c.channel} value={c.channel}>
                    {c.channel} {c.live ? "🟢" : ""}
                  </option>
                ))}
              </select>

              <label className="block text-slate-400">Kick Vaga 2</label>
              <select
                value={cfgDraft.kickSlot2}
                onChange={(e) => setCfgDraft({ ...cfgDraft, kickSlot2: e.target.value })}
                className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-1.5 text-white"
              >
                <option value="">Automático</option>
                <option value="none">Desligada</option>
                {kickChannels.map((c) => (
                  <option key={c.channel} value={c.channel}>
                    {c.channel} {c.live ? "🟢" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* Activity / Registro */}
            <div className="pt-2 border-t border-slate-800 space-y-1.5">
              <div className="font-semibold text-slate-300">Registro de Lives</div>
              <div className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-slate-400">
                {state.logs.length === 0 ? (
                  <div>Nenhuma atividade registrada ainda.</div>
                ) : (
                  state.logs.slice(0, 20).map((l) => (
                    <div key={l.id} className="truncate">
                      <span className="font-mono text-slate-500 mr-1.5">
                        {new Date(l.ts * 1000).toLocaleTimeString("pt-BR")}
                      </span>
                      <span className="text-slate-200">{l.channel}:</span> {l.message}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
