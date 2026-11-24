import { useEffect, useRef, useState } from "react";
import { Send, MessageSquare } from "lucide-react";
import { AccountTelemetry, ChatMessage } from "../lib/types";
import { api } from "../lib/api";

const CHANNELS = [
  { id: "mundo", label: "Mundo" },
  { id: "comercio", label: "Comércio" },
  { id: "duvidas", label: "Dúvidas" },
] as const;

const CARGO_COLOR: Record<string, string> = {
  admin: "text-rose-400",
  mod: "text-emerald-400",
  tutor: "text-sky-400",
  vip: "text-amber-300",
};

export function ChatView({
  accounts,
  onToast,
}: {
  accounts: AccountTelemetry[];
  onToast: (msg: string) => void;
}) {
  const [canal, setCanal] = useState<string>("mundo");
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({
    mundo: [],
    comercio: [],
    duvidas: [],
  });
  const [speakerId, setSpeakerId] = useState<number>(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const onlineAccounts = accounts.filter((a) => a.state === "ONLINE");
  const activeSpeaker = onlineAccounts.find((a) => a.id === speakerId) || onlineAccounts[0];

  useEffect(() => {
    CHANNELS.forEach((c) => {
      api
        .getChatMessages(c.id)
        .then((list) =>
          setMessages((prev) => ({ ...prev, [c.id]: Array.isArray(list) ? list : [] }))
        )
        .catch(() => {});
    });

    const off = api.onChat((ev) => {
      if (ev.type === "chat" && ev.msg && ev.canal) {
        const ch = ev.canal;
        const msg = ev.msg;
        setMessages((prev) => {
          const cur = prev[ch] || [];
          if (cur.some((m) => String(m.id) === String(msg.id))) return prev;
          return { ...prev, [ch]: [...cur.slice(-199), msg] };
        });
      } else if (ev.type === "history" && ev.canal && ev.msgs) {
        setMessages((prev) => ({ ...prev, [ev.canal!]: ev.msgs! }));
      } else if (ev.type === "del" && ev.canal && ev.delId) {
        setMessages((prev) => ({
          ...prev,
          [ev.canal!]: (prev[ev.canal!] || []).filter((m) => String(m.id) !== ev.delId),
        }));
      } else if (ev.type === "notice" && ev.notice) {
        onToast(ev.notice);
      }
    });
    return () => {
      if (typeof off === "function") off();
    };
  }, []);

  const currentList = messages[canal] || [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentList.length, canal]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSpeaker || !text.trim()) return;
    setSending(true);
    try {
      await api.sendChatMessage(activeSpeaker.id, canal, text);
      setText("");
    } catch (err) {
      onToast(String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-7.5rem)] max-w-4xl rounded-2xl bg-[#111525] border border-slate-800 overflow-hidden">
      {/* Channel Tabs */}
      <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-2 bg-[#0d101d]">
        <div className="flex items-center gap-1.5">
          {CHANNELS.map((c) => (
            <button
              key={c.id}
              onClick={() => setCanal(c.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                canal === c.id
                  ? "bg-indigo-500 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-white"
              }`}
            >
              #{c.label}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-500 flex items-center gap-1">
          <MessageSquare className="w-3.5 h-3.5" /> {currentList.length} mensagens (PT-BR)
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-1.5 text-xs">
        {currentList.length === 0 ? (
          <div className="text-center text-slate-500 py-12">
            Aguardando mensagens do canal #{canal}...
          </div>
        ) : (
          currentList.map((m) => {
            const timeStr = new Date(m.ts).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            });
            const rowStyle =
              m.kind === "shiny"
                ? "bg-amber-500/10 border border-amber-500/25 rounded-lg px-2.5 py-1.5 text-amber-200"
                : m.kind === "rare"
                ? "bg-fuchsia-500/10 border border-fuchsia-500/25 rounded-lg px-2.5 py-1.5 text-fuchsia-200"
                : m.kind === "ad"
                ? "bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2.5 py-1.5"
                : "py-0.5";
            return (
              <div key={String(m.id)} className={`leading-relaxed break-words ${rowStyle}`}>
                <span className="font-mono text-[10px] text-slate-500 mr-2">{timeStr}</span>
                {m.guild && (
                  <span
                    className="text-[10px] font-bold px-1 py-0.2 rounded mr-1.5 bg-slate-800"
                    style={m.guildColor ? { color: m.guildColor } : undefined}
                  >
                    [{m.guild}]
                  </span>
                )}
                {m.de && (
                  <span
                    className={`font-semibold mr-1.5 ${
                      (m.cargo && CARGO_COLOR[m.cargo]) || "text-sky-300"
                    }`}
                  >
                    {m.de}
                    {m.nivel > 0 && (
                      <span className="text-[10px] text-slate-500 font-normal ml-0.5">
                        ({m.nivel})
                      </span>
                    )}
                    :
                  </span>
                )}
                <span className="text-slate-200">{m.text}</span>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSend}
        className="p-3 border-t border-slate-800 bg-[#0d101d] flex items-center gap-2"
      >
        <select
          value={activeSpeaker?.id || 0}
          onChange={(e) => setSpeakerId(Number(e.target.value))}
          disabled={onlineAccounts.length === 0}
          className="rounded-lg bg-[#111525] border border-slate-700 px-2.5 py-2 text-xs text-slate-200 max-w-36"
        >
          {onlineAccounts.length === 0 ? (
            <option value={0}>Sem conta online</option>
          ) : (
            onlineAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nick}
              </option>
            ))
          )}
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={200}
          disabled={!activeSpeaker || sending}
          placeholder={`Enviar mensagem em #${canal} (máx 200 caracteres, sem links)...`}
          className="flex-1 rounded-lg bg-[#111525] border border-slate-700 px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          disabled={!activeSpeaker || !text.trim() || sending}
          className="px-3.5 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
        >
          <Send className="w-3.5 h-3.5" /> Enviar
        </button>
      </form>
    </div>
  );
}
