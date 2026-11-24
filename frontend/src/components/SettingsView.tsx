import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Save,
  Copy,
  Check,
  Wifi,
  Send,
  Pencil,
  Shield,
  Sliders,
  BarChart3,
} from "lucide-react";
import {
  AccountRecord,
  BALL_OPTIONS,
  CardStyle,
  GlobalSettings,
  POTION_OPTIONS,
  ProxyConfig,
  REVIVE_ICON,
  RestockConfig,
  RestockRule,
  ballIcon,
  defaultAccountOptions,
  potionIcon,
} from "../lib/types";
import { api } from "../lib/api";
import { ItemSprite } from "./PokemonSprite";

function asAccountList(list: AccountRecord[] | null | undefined): AccountRecord[] {
  return list || [];
}

function formatAddedAccountToast(res: { account: AccountRecord; probe?: { level?: number } }): string {
  const lvl = res.probe?.level ? ` (Lv ${res.probe.level})` : "";
  return `Conta ${res.account.nick} adicionada${lvl}!`;
}

export function SettingsView({
  settings,
  onSettingsChange,
  onToast,
}: {
  settings: GlobalSettings;
  onSettingsChange: (gs: GlobalSettings) => void;
  onToast: (msg: string) => void;
}) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [bookmarklet, setBookmarklet] = useState("");
  const [copiedBm, setCopiedBm] = useState(false);

  // Add account state
  const [showAdd, setShowAdd] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [nick, setNick] = useState("");
  const [token, setToken] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [useProxy, setUseProxy] = useState(false);
  const [proxy, setProxy] = useState<ProxyConfig>({
    scheme: "socks5",
    host: "",
    port: 1080,
    username: "",
    password: "",
  });
  const [skipTest, setSkipTest] = useState(false);
  const [savingAcc, setSavingAcc] = useState(false);
  const [testingProxy, setTestingProxy] = useState(false);

  // Edit account state
  const [editing, setEditing] = useState<AccountRecord | null>(null);

  // Local settings draft
  const [gs, setGs] = useState<GlobalSettings>(settings);
  const [autostart, setAutostart] = useState(false);
  const [autostartBusy, setAutostartBusy] = useState(false);

  useEffect(() => {
    setGs(settings);
  }, [settings]);

  const reloadAccounts = async () => {
    try {
      const list = await api.listAccounts();
      setAccounts(asAccountList(list));
    } catch (e) {
      onToast(`Erro ao listar contas: ${String(e)}`);
    }
  };

  useEffect(() => {
    reloadAccounts();
    api.getBookmarkletCode().then(setBookmarklet).catch(() => {});
    api.getAutostart().then(setAutostart).catch(() => {});
  }, []);

  const handleParsePaste = async (val: string) => {
    setPasteText(val);
    if (!val.trim()) return;
    try {
      const parsed = await api.parseImportText(val);
      setNick(parsed.nick);
      setToken(parsed.token);
      if (parsed.deviceId) setDeviceId(parsed.deviceId);
      onToast(`Sessão de ${parsed.nick} reconhecida!`);
    } catch {
      // Wait for user to finish pasting
    }
  };

  const handleTestProxy = async (p: ProxyConfig) => {
    setTestingProxy(true);
    try {
      const ip = await api.testProxy(p);
      onToast(`Proxy OK! IP de saída: ${ip}`);
    } catch (e) {
      onToast(`Falha no proxy: ${String(e)}`);
    }
    setTestingProxy(false);
  };

  const handleAddAccount = async () => {
    const payload = {
      nick,
      token,
      deviceId,
      enabled: true,
      proxy: useProxy && proxy.host ? proxy : null,
      options: defaultAccountOptions(),
      skipTest,
    };
    setSavingAcc(true);
    try {
      const res = await api.addAccount(payload);
      onToast(formatAddedAccountToast(res));
      setShowAdd(false);
      setPasteText("");
      setNick("");
      setToken("");
      setDeviceId("");
      setUseProxy(false);
      await reloadAccounts();
    } catch (e) {
      onToast(`Erro ao adicionar conta: ${String(e)}`);
    }
    setSavingAcc(false);
  };

  const updateRestock = (patch: Partial<RestockConfig>) => {
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            options: {
              ...prev.options,
              restock: { ...prev.options.restock, ...patch },
            },
          }
        : prev
    );
  };

  const updateRestockRule = (
    kind: "potion" | "ball" | "revive",
    patch: Partial<RestockRule>
  ) => {
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            options: {
              ...prev.options,
              restock: {
                ...prev.options.restock,
                [kind]: { ...prev.options.restock[kind], ...patch },
              },
            },
          }
        : prev
    );
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    try {
      await api.updateAccount(editing);
      onToast(`Conta ${editing.nick} atualizada!`);
      setEditing(null);
      await reloadAccounts();
    } catch (e) {
      onToast(`Erro ao salvar: ${String(e)}`);
    }
  };

  const handleDelete = async (acc: AccountRecord) => {
    if (!confirm(`Remover a conta "${acc.nick}"?`)) return;
    try {
      await api.deleteAccount(acc.id);
      onToast(`Conta ${acc.nick} removida`);
      await reloadAccounts();
    } catch (e) {
      onToast(`Erro ao remover: ${String(e)}`);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await api.updateSettings(gs);
      onSettingsChange(gs);
      onToast("Configurações salvas!");
    } catch (e) {
      onToast(`Erro ao salvar configurações: ${String(e)}`);
    }
  };

  const handleTestDiscord = async () => {
    try {
      await api.testDiscordWebhook(gs.discordWebhookUrl);
      onToast("Mensagem de teste enviada ao Discord!");
    } catch (e) {
      onToast(`Falha no Discord: ${String(e)}`);
    }
  };

  const handleSendDailyReport = async () => {
    try {
      await api.sendDailyReportNow(gs.discordWebhookUrl);
      onToast("Relatório diário enviado ao Discord!");
    } catch (e) {
      onToast(`Falha ao enviar relatório: ${String(e)}`);
    }
  };

  const handleToggleAutostart = async (checked: boolean) => {
    const okMsg = checked
      ? "PokeMngr será iniciado com o Windows!"
      : "Início automático com o Windows desativado.";
    setAutostartBusy(true);
    try {
      await api.setAutostart(checked);
      setAutostart(checked);
      onToast(okMsg);
    } catch (e) {
      onToast(`Erro no autostart: ${String(e)}`);
    }
    setAutostartBusy(false);
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Accounts Section */}
      <section className="rounded-2xl bg-[#111525] border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              Contas PokéIdle ({accounts.length}/4)
            </h2>
            <p className="text-xs text-slate-400">
              Limite máximo de 4 contas conforme os Termos de Uso do PokéIdle.
            </p>
          </div>
          {accounts.length < 4 && (
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs inline-flex items-center gap-1.5 transition"
            >
              <Plus className="w-4 h-4" /> Adicionar Conta
            </button>
          )}
        </div>

        {/* Add Account Wizard */}
        {showAdd && (
          <div className="rounded-xl bg-[#0b0e1b] border border-slate-700/80 p-4 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-sm font-medium text-amber-300">
                Importar conta do pokeidle.io/app
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(bookmarklet);
                  setCopiedBm(true);
                  setTimeout(() => setCopiedBm(false), 2000);
                  onToast("Código copiado! Cole no console (F12) do pokeidle.io/app ou salve como favorito.");
                }}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 inline-flex items-center gap-1.5 border border-slate-700"
              >
                {copiedBm ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                Copiar Extrator (Favorito / Console F12)
              </button>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Colar JSON copiado do jogo (preenche os campos abaixo automaticamente)
              </label>
              <textarea
                rows={2}
                value={pasteText}
                onChange={(e) => handleParsePaste(e.target.value)}
                placeholder='{"nick":"SeuNick","token":"...","dispositivo":"..."}'
                className="w-full rounded-lg bg-[#111525] border border-slate-700 px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Nick</label>
                <input
                  value={nick}
                  onChange={(e) => setNick(e.target.value)}
                  className="w-full rounded-lg bg-[#111525] border border-slate-700 px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Token</label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="w-full rounded-lg bg-[#111525] border border-slate-700 px-3 py-2 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Device ID (opcional)
                </label>
                <input
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                  placeholder="Auto UUID se vazio"
                  className="w-full rounded-lg bg-[#111525] border border-slate-700 px-3 py-2 text-xs text-white font-mono"
                />
              </div>
            </div>

            {/* Proxy */}
            <div className="space-y-2 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useProxy}
                  onChange={(e) => setUseProxy(e.target.checked)}
                />
                Usar proxy dedicado (SOCKS5 / HTTP) nesta conta
              </label>
              {useProxy && (
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
                  <select
                    value={proxy.scheme}
                    onChange={(e) => setProxy({ ...proxy, scheme: e.target.value })}
                    className="rounded-lg bg-[#111525] border border-slate-700 px-2 py-2 text-xs text-white"
                  >
                    <option value="socks5">socks5</option>
                    <option value="socks5h">socks5h</option>
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </select>
                  <input
                    placeholder="Host"
                    value={proxy.host}
                    onChange={(e) => setProxy({ ...proxy, host: e.target.value })}
                    className="col-span-2 rounded-lg bg-[#111525] border border-slate-700 px-2.5 py-2 text-xs text-white"
                  />
                  <input
                    type="number"
                    placeholder="Porta"
                    value={proxy.port}
                    onChange={(e) => setProxy({ ...proxy, port: Number(e.target.value) })}
                    className="rounded-lg bg-[#111525] border border-slate-700 px-2.5 py-2 text-xs text-white"
                  />
                  <input
                    placeholder="Usuário"
                    value={proxy.username || ""}
                    onChange={(e) => setProxy({ ...proxy, username: e.target.value })}
                    className="rounded-lg bg-[#111525] border border-slate-700 px-2.5 py-2 text-xs text-white"
                  />
                  <input
                    type="password"
                    placeholder="Senha"
                    value={proxy.password || ""}
                    onChange={(e) => setProxy({ ...proxy, password: e.target.value })}
                    className="rounded-lg bg-[#111525] border border-slate-700 px-2.5 py-2 text-xs text-white"
                  />
                  <button
                    disabled={testingProxy || !proxy.host}
                    onClick={() => handleTestProxy(proxy)}
                    className="col-span-2 md:col-span-2 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-sky-300 inline-flex items-center justify-center gap-1.5 border border-slate-700"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    {testingProxy ? "Testando..." : "Testar Proxy"}
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <label className="inline-flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={skipTest}
                  onChange={(e) => setSkipTest(e.target.checked)}
                />
                Pular teste de conexão ao salvar
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAdd(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  disabled={savingAcc || !nick || !token}
                  onClick={handleAddAccount}
                  className="px-4 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs disabled:opacity-50"
                >
                  {savingAcc ? "Validando..." : skipTest ? "Salvar Conta" : "Testar e Salvar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Accounts List */}
        {accounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-400">
            Nenhuma conta cadastrada ainda. Clique em <b>Adicionar Conta</b> para começar.
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="rounded-xl bg-[#0b0e1b] border border-slate-800 px-4 py-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-white">{acc.nick}</span>
                    <span className="text-[11px] font-mono text-slate-500">
                      token {acc.tokenHint}
                    </span>
                    {!acc.enabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                        Desativada
                      </span>
                    )}
                    {acc.proxy?.host && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300">
                        {acc.proxy.scheme}://{acc.proxy.host}:{acc.proxy.port}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Auto-Catch: {acc.options.autoCatch ? "ON" : "OFF"} · Recompra:{" "}
                    {acc.options.restock?.enabled ? "Avançada ON" : "OFF"} · Modo:{" "}
                    {acc.options.directMode ? "Direto" : "Bridge WS"}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setEditing(structuredClone(acc))}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                    title="Editar conta e recompra"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(acc)}
                    className="p-2 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300"
                    title="Remover conta"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Edit Account Drawer / Inline Modal */}
        {editing && (
          <div className="rounded-xl bg-[#0d1224] border border-indigo-500/40 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-indigo-200 flex items-center gap-2">
                <Sliders className="w-4 h-4" /> Editando {editing.nick}
              </h3>
              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                />
                Conta ativa
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Novo Token (deixe vazio p/ manter)</label>
                <input
                  type="password"
                  value={editing.token || ""}
                  onChange={(e) => setEditing({ ...editing, token: e.target.value })}
                  className="w-full rounded-lg bg-[#111525] border border-slate-700 px-3 py-1.5 text-xs font-mono text-white"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-200 mt-5">
                <input
                  type="checkbox"
                  checked={editing.options.autoCatch}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      options: { ...editing.options, autoCatch: e.target.checked },
                    })
                  }
                />
                Auto-Catch (jogar Pokébolas)
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-200 mt-5">
                <input
                  type="checkbox"
                  checked={editing.options.directMode}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      options: { ...editing.options, directMode: e.target.checked },
                    })
                  }
                />
                Modo Direto (desativa WS headless)
              </label>
            </div>

            {/* Advanced Restock (manager-online + pokeidleDeck merged) */}
            <div className="rounded-lg bg-[#090c18] border border-slate-800 p-3 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-amber-300">
                  <input
                    type="checkbox"
                    checked={editing.options.restock.enabled}
                    onChange={(e) => updateRestock({ enabled: e.target.checked })}
                  />
                  Recompra Automática Avançada (Histerese + Piso de Ouro)
                </label>
                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={editing.options.restock.potionFirst}
                      onChange={(e) => updateRestock({ potionFirst: e.target.checked })}
                    />
                    Poção em 1º na fila
                  </label>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-slate-400">Piso Ouro:</span>
                    <input
                      type="number"
                      value={editing.options.restock.goldFloor}
                      onChange={(e) => updateRestock({ goldFloor: Number(e.target.value) })}
                      className="w-28 rounded bg-[#111525] border border-slate-700 px-2 py-1 text-xs font-mono text-amber-300"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                {/* Potion rule */}
                <div className="rounded-lg bg-[#111525] p-2.5 space-y-2 border border-slate-800">
                  <label className="flex items-center gap-2 font-medium text-rose-300">
                    <input
                      type="checkbox"
                      checked={editing.options.restock.potion.enabled}
                      onChange={(e) => updateRestockRule("potion", { enabled: e.target.checked })}
                    />
                    <ItemSprite icon={potionIcon(editing.options.restock.potion.id || 204)} size={20} />
                    Poções
                  </label>
                  <select
                    value={editing.options.restock.potion.id}
                    onChange={(e) => updateRestockRule("potion", { id: Number(e.target.value) })}
                    className="w-full rounded bg-[#0a0d18] border border-slate-700 px-2 py-1 text-xs"
                  >
                    <option value={0}>Auto (Equipada / Melhor custo HP)</option>
                    {POTION_OPTIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <span className="text-[10px] text-slate-500">Abaixo de</span>
                      <input
                        type="number"
                        value={editing.options.restock.potion.below}
                        onChange={(e) => updateRestockRule("potion", { below: Number(e.target.value) })}
                        className="w-full rounded bg-[#0a0d18] border border-slate-700 px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">Manter em</span>
                      <input
                        type="number"
                        value={editing.options.restock.potion.keep}
                        onChange={(e) => updateRestockRule("potion", { keep: Number(e.target.value) })}
                        className="w-full rounded bg-[#0a0d18] border border-slate-700 px-2 py-1 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Ball rule */}
                <div className="rounded-lg bg-[#111525] p-2.5 space-y-2 border border-slate-800">
                  <label className="flex items-center gap-2 font-medium text-sky-300">
                    <input
                      type="checkbox"
                      checked={editing.options.restock.ball.enabled}
                      onChange={(e) => updateRestockRule("ball", { enabled: e.target.checked })}
                    />
                    <ItemSprite icon={ballIcon(editing.options.restock.ball.id || 4)} size={20} />
                    Pokébolas
                  </label>
                  <select
                    value={editing.options.restock.ball.id}
                    onChange={(e) => updateRestockRule("ball", { id: Number(e.target.value) })}
                    className="w-full rounded bg-[#0a0d18] border border-slate-700 px-2 py-1 text-xs"
                  >
                    <option value={0}>Auto (Bola equipada)</option>
                    {BALL_OPTIONS.filter((b) => b.id <= 4).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <span className="text-[10px] text-slate-500">Abaixo de</span>
                      <input
                        type="number"
                        value={editing.options.restock.ball.below}
                        onChange={(e) => updateRestockRule("ball", { below: Number(e.target.value) })}
                        className="w-full rounded bg-[#0a0d18] border border-slate-700 px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">Manter em</span>
                      <input
                        type="number"
                        value={editing.options.restock.ball.keep}
                        onChange={(e) => updateRestockRule("ball", { keep: Number(e.target.value) })}
                        className="w-full rounded bg-[#0a0d18] border border-slate-700 px-2 py-1 font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Revive rule */}
                <div className="rounded-lg bg-[#111525] p-2.5 space-y-2 border border-slate-800">
                  <label className="flex items-center gap-2 font-medium text-emerald-300">
                    <input
                      type="checkbox"
                      checked={editing.options.restock.revive.enabled}
                      onChange={(e) => updateRestockRule("revive", { enabled: e.target.checked })}
                    />
                    <ItemSprite icon={REVIVE_ICON} size={20} />
                    Revives (mais barato)
                  </label>
                  <div className="text-[11px] text-slate-500 py-1">
                    Soma todos os revives no inventário
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <span className="text-[10px] text-slate-500">Abaixo de</span>
                      <input
                        type="number"
                        value={editing.options.restock.revive.below}
                        onChange={(e) => updateRestockRule("revive", { below: Number(e.target.value) })}
                        className="w-full rounded bg-[#0a0d18] border border-slate-700 px-2 py-1 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-500">Manter em</span>
                      <input
                        type="number"
                        value={editing.options.restock.revive.keep}
                        onChange={(e) => updateRestockRule("revive", { keep: Number(e.target.value) })}
                        className="w-full rounded bg-[#0a0d18] border border-slate-700 px-2 py-1 font-mono"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 text-xs text-slate-300"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveEdit}
                className="px-4 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-xs inline-flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" /> Salvar Alterações
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Global Settings Section */}
      <section className="rounded-2xl bg-[#111525] border border-slate-800 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-400" /> Configurações Gerais & Bandeja
          </h2>
          <button
            onClick={handleSaveSettings}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs inline-flex items-center gap-1.5"
          >
            <Save className="w-4 h-4" /> Salvar Configurações
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="space-y-3">
            <div>
              <label className="block text-slate-400 mb-1">Webhook do Discord</label>
              <div className="flex gap-2">
                <input
                  value={gs.discordWebhookUrl}
                  onChange={(e) => setGs({ ...gs, discordWebhookUrl: e.target.value })}
                  placeholder="https://discord.com/api/webhooks/..."
                  className="flex-1 rounded-lg bg-[#0b0e1b] border border-slate-700 px-3 py-2 text-white font-mono"
                />
                <button
                  onClick={handleTestDiscord}
                  className="px-3 py-2 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 inline-flex items-center gap-1"
                >
                  <Send className="w-3.5 h-3.5" /> Testar
                </button>
                <button
                  onClick={handleSendDailyReport}
                  title="Enviar agora o relatório acumulado do dia atual"
                  className="px-3 py-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 inline-flex items-center gap-1"
                >
                  <BarChart3 className="w-3.5 h-3.5" /> Relatório
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block text-slate-400 mb-1">
                  Hora Relatório (0–23)
                </label>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={gs.dailyReportHour}
                  onChange={(e) =>
                    setGs({
                      ...gs,
                      dailyReportHour: Math.max(0, Math.min(23, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Fuso Horário</label>
                <input
                  list="tz-options"
                  value={gs.reportTz}
                  onChange={(e) => setGs({ ...gs, reportTz: e.target.value })}
                  placeholder="America/Sao_Paulo"
                  className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-white font-mono"
                />
                <datalist id="tz-options">
                  <option value="America/Sao_Paulo" />
                  <option value="America/Manaus" />
                  <option value="America/Cuiaba" />
                  <option value="America/Fortaleza" />
                  <option value="America/Rio_Branco" />
                  <option value="Europe/Lisbon" />
                  <option value="UTC" />
                </datalist>
              </div>
              <div>
                <label
                  className="block text-slate-400 mb-1"
                  title="Segundos offline antes de notificar queda no Discord (0 = imediato)"
                >
                  Alerta Queda (seg)
                </label>
                <input
                  type="number"
                  min={0}
                  max={3600}
                  value={gs.downAlertDelaySec}
                  onChange={(e) =>
                    setGs({
                      ...gs,
                      downAlertDelaySec: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                  className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-2.5 py-2 text-white font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-400 mb-1">
                  Espera Login Externo (min)
                </label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={gs.externalLoginWaitMin}
                  onChange={(e) =>
                    setGs({ ...gs, externalLoginWaitMin: Number(e.target.value) })
                  }
                  className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-3 py-2 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Estilo dos Cards</label>
                <select
                  value={gs.cardStyle}
                  onChange={(e) =>
                    setGs({ ...gs, cardStyle: e.target.value as CardStyle })
                  }
                  className="w-full rounded-lg bg-[#0b0e1b] border border-slate-700 px-3 py-2 text-white"
                >
                  <option value="padrao">Padrão (Grade)</option>
                  <option value="medalhao">Medalhão (Anéis XP)</option>
                  <option value="versus">Versus (Treinador vs Pokémon)</option>
                  <option value="corrida">Corrida (Barras)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-3 space-y-2.5">
              <div className="font-medium text-slate-200">Bandeja & Deck Visual</div>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autostart}
                  disabled={autostartBusy}
                  onChange={(e) => handleToggleAutostart(e.target.checked)}
                />
                Iniciar automaticamente com o Windows
              </label>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gs.minimizeToTrayOnClose}
                  onChange={(e) =>
                    setGs({ ...gs, minimizeToTrayOnClose: e.target.checked })
                  }
                />
                Ao clicar no X, minimizar para a bandeja do sistema (continuar farmando)
              </label>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gs.startMinimized}
                  onChange={(e) => setGs({ ...gs, startMinimized: e.target.checked })}
                />
                Iniciar minimizado na bandeja
              </label>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gs.deckReduceMotion}
                  onChange={(e) =>
                    setGs({ ...gs, deckReduceMotion: e.target.checked })
                  }
                />
                Deck: Menos animações (prefers-reduced-motion)
              </label>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gs.deckUltra}
                  onChange={(e) => setGs({ ...gs, deckUltra: e.target.checked })}
                />
                Deck: Abrir em modo ULTRA economia
              </label>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
