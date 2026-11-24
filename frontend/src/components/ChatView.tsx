import { useEffect, useRef, useState } from "react";
import { Send, MessageSquare, Sparkles, ShoppingCart, X } from "lucide-react";
import {
  AccountTelemetry,
  ChatMessage,
  ListingDetail,
  PokemonDetail,
  fmtCompact,
} from "../lib/types";
import { api } from "../lib/api";
import { ItemSprite } from "./PokemonSprite";
import { PokemonSheetModal } from "./PokemonSheetModal";
import { DsConfirmDialog, DsDialog } from "./DsPrimitives";

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
  bridgePort,
  onToast,
}: {
  accounts: AccountTelemetry[];
  bridgePort: number;
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
  const [publicSheet, setPublicSheet] = useState<PokemonDetail | null>(null);
  const [adModal, setAdModal] = useState<ListingDetail | null>(null);
  const [loadingModal, setLoadingModal] = useState(false);
  const [confirmBuyAd, setConfirmBuyAd] = useState(false);
  const [buyingAd, setBuyingAd] = useState(false);
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
        const ch = ev.canal;
        const msgs = ev.msgs;
        setMessages((prev) => ({ ...prev, [ch]: msgs }));
      } else if (ev.type === "del" && ev.canal && ev.delId) {
        const ch = ev.canal;
        const delId = ev.delId;
        setMessages((prev) => ({
          ...prev,
          [ch]: (prev[ch] || []).filter((m) => String(m.id) !== delId),
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
    }
    setSending(false);
  };

  const handleOpenPublicPokemon = async (nick: string, pid: number) => {
    setLoadingModal(true);
    try {
      const det = await api.getPublicPokemonSheet(nick, pid);
      setPublicSheet(det);
    } catch (err) {
      onToast(`Ficha: ${String(err)}`);
    }
    setLoadingModal(false);
  };

  const handleOpenChatAd = async (listingId: number) => {
    setLoadingModal(true);
    try {
      const det = await api.getMarketListingDetail(listingId);
      setAdModal(det);
    } catch (err) {
      onToast(`Anúncio #${listingId}: ${String(err)}`);
    }
    setLoadingModal(false);
  };

  const handleBuyAd = () => {
    if (!adModal || !activeSpeaker) {
      onToast("Nenhuma conta online selecionada para comprar.");
      return;
    }
    setConfirmBuyAd(true);
  };

  const handleConfirmBuyAd = async () => {
    if (!adModal || !activeSpeaker) return;
    const buyerAccountId = activeSpeaker.id;
    const listingId = adModal.id;
    const qty = adModal.qtd;
    const price = adModal.preco;
    const moeda = adModal.moeda;
    setBuyingAd(true);
    try {
      const res = await api.buyMarketListing(buyerAccountId, listingId, qty, price, moeda);
      onToast(`Mercado: ${res.status} — ${res.detail}`);
      setConfirmBuyAd(false);
      setAdModal(null);
    } catch (err) {
      onToast(`Falha na compra: ${String(err)}`);
    }
    setBuyingAd(false);
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
                {m.pk && (
                  <button
                    type="button"
                    disabled={loadingModal}
                    onClick={() => handleOpenPublicPokemon(m.pk!.nick, m.pk!.id)}
                    className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/20 hover:bg-indigo-500/35 text-indigo-200 border border-indigo-500/30 text-[11px] font-medium transition align-middle"
                  >
                    <Sparkles className="w-3 h-3" /> Ver ficha: {m.pk.label}
                  </button>
                )}
                {m.ad && (
                  <button
                    type="button"
                    disabled={loadingModal}
                    onClick={() => handleOpenChatAd(m.ad!.id)}
                    className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/20 hover:bg-emerald-500/35 text-emerald-200 border border-emerald-500/30 text-[11px] font-medium transition align-middle"
                  >
                    <ShoppingCart className="w-3 h-3" /> Abrir anúncio #{m.ad.id}
                  </button>
                )}
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

      {/* Public Pokémon Sheet Modal */}
      {publicSheet && (
        <PokemonSheetModal
          sheet={publicSheet}
          bridgePort={bridgePort}
          onClose={() => setPublicSheet(null)}
        />
      )}

      {/* Market Listing Modal (Pokémon sheet with buy button OR item listing card) */}
      {adModal && adModal.pokemon && (
        <PokemonSheetModal
          sheet={adModal.pokemon}
          bridgePort={bridgePort}
          listing={adModal}
          buying={buyingAd}
          onBuy={handleBuyAd}
          onClose={() => setAdModal(null)}
        />
      )}

      {adModal && !adModal.pokemon && (
        <DsDialog open onClose={() => setAdModal(null)} maxWidthClass="max-w-md">
          <div className="px-box p-5 space-y-4 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <div className="px-stage !border-2 w-12 h-12 flex items-center justify-center shrink-0">
                  <ItemSprite icon={adModal.itemIcon} size={38} alt={adModal.nome} />
                </div>
                <div>
                  <div className="font-pixel text-[12px] text-[var(--ink)]">
                    {adModal.qtd}× {adModal.nome || `Anúncio #${adModal.id}`}
                  </div>
                  <div className="text-[var(--ink-muted)] font-semibold mt-0.5">
                    Anúncio #{adModal.id} · Vendedor: <b className="text-[var(--ink)]">{adModal.vendedor || "?"}</b>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setAdModal(null)}
                className="ds-btn ds-btn-red ds-btn-sm !px-2"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="px-inset p-3 flex items-center justify-between">
              <div>
                <div className="font-pixel text-[8px] text-[var(--ink-muted)]">PREÇO UNITÁRIO</div>
                <div className="font-pixel text-sm text-[var(--ink-accent-amber)] mt-0.5">
                  {fmtCompact(adModal.preco)} {adModal.moeda === "orb" ? "Gemas" : "Gold"}
                </div>
              </div>
              <button
                disabled={buyingAd || !activeSpeaker}
                onClick={handleBuyAd}
                className="ds-btn ds-btn-green"
              >
                <ShoppingCart className="w-3.5 h-3.5" />
                {buyingAd ? "Comprando..." : "Comprar"}
              </button>
            </div>
          </div>
        </DsDialog>
      )}
      <DsConfirmDialog
        open={confirmBuyAd && Boolean(adModal)}
        title={`Comprar anúncio #${adModal?.id || ""}?`}
        description={`Comprar ${adModal?.qtd || 1}× ${adModal?.nome || "item"} por ${fmtCompact(adModal?.preco || 0)} ${adModal?.moeda === "orb" ? "Gemas" : "Gold"} usando ${activeSpeaker?.nick || ""}?`}
        confirmLabel="Confirmar Compra"
        tone="primary"
        busy={buyingAd}
        onConfirm={handleConfirmBuyAd}
        onClose={() => setConfirmBuyAd(false)}
      />
    </div>
  );
}
