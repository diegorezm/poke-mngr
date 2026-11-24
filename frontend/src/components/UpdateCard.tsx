import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { api } from "../lib/api";
import type { UpdateState } from "../lib/types";

interface UpdateStore {
  data: UpdateState | null;
  checking: boolean;
  applying: boolean;
  message: { tone: "ok" | "error"; text: string } | null;
}

let store: UpdateStore = {
  data: null,
  checking: false,
  applying: false,
  message: null,
};

const listeners = new Set<() => void>();

function patchStore(patch: Partial<UpdateStore>) {
  store = { ...store, ...patch };
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return store;
}

function dismissedKey(version: string): string {
  return `pokemngr.update.dismissed.${version}`;
}

function isVersionDismissed(version: string): boolean {
  try {
    return sessionStorage.getItem(dismissedKey(version)) === "1";
  } catch {
    return false;
  }
}

function markVersionDismissed(version: string) {
  try {
    sessionStorage.setItem(dismissedKey(version), "1");
  } catch {
    // Ignore storage unavailability
  }
}

function formatCheckedAgo(checkedAt: number, nowMs: number): string {
  if (!checkedAt) return "ainda não verificado";
  const mins = Math.max(0, Math.round((nowMs - checkedAt) / 60000));
  if (mins < 1) return "agora há pouco";
  if (mins < 60) return `há ${mins} min`;
  return `há ${Math.round(mins / 60)} h`;
}

function checkMessageFor(d: UpdateState): { tone: "ok" | "error"; text: string } | null {
  if (d.error) return { tone: "error", text: d.error };
  if (d.available) return null;
  return { tone: "ok", text: `Você já está na versão mais recente (v${d.current}).` };
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function refreshUpdateState() {
  try {
    const data = await api.getUpdateState();
    patchStore({ data });
  } catch {
    // Ignore transient IPC errors
  }
}

async function checkForUpdateNow() {
  patchStore({ checking: true, message: null });
  try {
    const data = await api.checkForUpdate();
    const message = checkMessageFor(data);
    patchStore({ data, message });
  } catch (e) {
    patchStore({ message: { tone: "error", text: errText(e) } });
  }
  patchStore({ checking: false });
}

async function applyUpdateNow() {
  patchStore({ applying: true, message: null });
  const poll = setInterval(() => {
    void refreshUpdateState();
  }, 1000);
  let keepApplying = false;
  try {
    const res = await api.applyUpdate();
    keepApplying = res.restarting;
    patchStore({ message: { tone: "ok", text: res.message } });
  } catch (e) {
    patchStore({ message: { tone: "error", text: errText(e) } });
  }
  clearInterval(poll);
  if (!keepApplying) {
    patchStore({ applying: false });
  }
  void refreshUpdateState();
}

function useUpdateStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

function ApplyControls({
  d,
  applying,
  compact = false,
}: {
  d: UpdateState;
  applying: boolean;
  compact?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!d.canApply) {
    if (!d.url) return null;
    return (
      <a
        href={d.url}
        target="_blank"
        rel="noreferrer"
        className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/35 text-xs font-semibold inline-flex items-center gap-1.5 transition"
      >
        <ExternalLink className="w-3.5 h-3.5" /> Abrir Release
      </a>
    );
  }

  if (confirming && !applying) {
    return (
      <div className="inline-flex items-center gap-1.5">
        <button
          onClick={() => {
            setConfirming(false);
            void applyUpdateNow();
          }}
          className="px-2.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1 transition"
        >
          Confirmar v{d.latest}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs"
        >
          Cancelar
        </button>
      </div>
    );
  }

  const label = applying ? d.step || "Atualizando…" : compact ? "Atualizar" : "Atualizar agora";
  return (
    <button
      disabled={applying}
      onClick={() => setConfirming(true)}
      className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 transition"
    >
      {applying ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <ArrowUpCircle className="w-3.5 h-3.5" />
      )}
      {label}
    </button>
  );
}

export function UpdateBanner() {
  const s = useUpdateStore();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    void refreshUpdateState();
    const timer = setInterval(() => {
      void refreshUpdateState();
    }, 60000);
    const onFocus = () => {
      void refreshUpdateState();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (s.applying && s.message?.tone === "ok") {
    return (
      <div className="bg-emerald-500/15 border-b border-emerald-500/30 px-5 py-2 text-xs text-emerald-200 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        <span>{s.message.text}</span>
      </div>
    );
  }

  const d = s.data;
  if (!d || !d.available || !d.latest) return null;
  if (dismissed === d.latest || isVersionDismissed(d.latest)) return null;

  return (
    <div className="bg-amber-500/12 border-b border-amber-500/30 px-5 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-amber-200 min-w-0">
          <ArrowUpCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="font-semibold">Nova versão v{d.latest} disponível</span>
          <span className="text-slate-400">(instalada: v{d.current})</span>
        </div>
        <div className="flex items-center gap-2">
          {d.notes && (
            <button
              onClick={() => setShowNotes((v) => !v)}
              className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700"
            >
              {showNotes ? "Ocultar notas" : "Ver novidades"}
            </button>
          )}
          <ApplyControls d={d} applying={s.applying} compact />
          <button
            onClick={() => {
              markVersionDismissed(d.latest);
              setDismissed(d.latest);
            }}
            className="px-2 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60"
          >
            Depois
          </button>
        </div>
      </div>
      {showNotes && d.notes && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/35 border border-slate-800 p-2.5 font-sans text-[11px] leading-relaxed text-slate-300">
          {d.notes}
        </pre>
      )}
      {s.message?.tone === "error" && (
        <div className="mt-1.5 text-rose-300">{s.message.text}</div>
      )}
    </div>
  );
}

export function UpdateSection({
  serverTimeMs,
}: {
  serverTimeMs: number;
}) {
  const s = useUpdateStore();

  useEffect(() => {
    void refreshUpdateState();
  }, []);

  const d = s.data;

  return (
    <section className="rounded-2xl bg-[#111525] border border-slate-800 p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <ArrowUpCircle className="w-5 h-5 text-amber-400" /> Atualizações (GitHub Releases)
          </h2>
          {d && (
            <p className="text-xs text-slate-400 mt-0.5">
              Versão instalada: <b className="font-mono text-slate-200">v{d.current}</b> · Repositório:{" "}
              <span className="font-mono text-slate-300">{d.repo}</span> · Última verificação:{" "}
              {formatCheckedAgo(d.checkedAt, serverTimeMs)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={s.checking || s.applying || !d?.enabled}
            onClick={() => void checkForUpdateNow()}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50 transition"
          >
            {s.checking ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            {s.checking ? "Verificando…" : "Verificar atualização"}
          </button>
          {d && d.available && <ApplyControls d={d} applying={s.applying} />}
        </div>
      </div>

      {!d && (
        <div className="text-xs text-slate-400">Carregando informações de atualização…</div>
      )}

      {d && !d.enabled && (
        <div className="text-xs text-slate-400">
          Verificação automática desativada neste computador (<code className="font-mono">UPDATE_CHECK=0</code>).
        </div>
      )}

      {d && d.enabled && d.available && d.latest && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="font-semibold text-amber-200">
              Versão v{d.latest} pronta para instalar
              {d.installerName && (
                <span className="ml-2 font-mono text-[11px] text-slate-400">
                  ({d.installerName})
                </span>
              )}
            </div>
            {d.url && (
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="text-amber-300 hover:underline inline-flex items-center gap-1"
              >
                Ver no GitHub <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {d.notes && (
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2.5 font-sans text-[11px] leading-relaxed text-slate-300">
              {d.notes}
            </pre>
          )}
          {!d.canApply && d.cannotApplyReason && (
            <div className="text-slate-300">{d.cannotApplyReason}</div>
          )}
          {d.canApply && (
            <div className="text-[11px] text-slate-400">
              O instalador NSIS é verificado por SHA-256 e roda silenciosamente; suas contas e banco de dados em{" "}
              <code className="font-mono">%LOCALAPPDATA%\PokeMngr</code> são preservados.
            </div>
          )}
        </div>
      )}

      {d && d.enabled && !d.available && !s.message && !d.error && d.latest && (
        <div className="text-xs text-emerald-300 inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> Você já está na versão mais recente (v{d.current}).
        </div>
      )}

      {s.message && (
        <div className={`text-xs ${s.message.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`}>
          {s.message.text}
        </div>
      )}

      {!s.message && d?.error && (
        <div className="text-xs text-rose-300">{d.error}</div>
      )}
    </section>
  );
}
