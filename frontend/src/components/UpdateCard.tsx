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
        className="ds-btn ds-btn-orange ds-btn-sm"
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
          className="ds-btn ds-btn-green ds-btn-sm"
        >
          Confirmar v{d.latest}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="ds-btn ds-btn-slate ds-btn-sm"
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
      className="ds-btn ds-btn-orange ds-btn-sm"
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
      <div className="bg-[#dcfce7] border-b-[3px] border-[var(--border-dark)] px-5 py-2 text-xs font-bold text-[#14532d] flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
        <span>{s.message.text}</span>
      </div>
    );
  }

  const d = s.data;
  if (!d || !d.available || !d.latest) return null;
  if (dismissed === d.latest || isVersionDismissed(d.latest)) return null;

  return (
    <div className="bg-amber-500/15 border-b-[1.5px] border-[var(--border-dark)] px-5 py-2 text-xs text-[var(--ink)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 font-bold">
          <ArrowUpCircle className="w-4 h-4 text-[var(--ink-accent-amber)] shrink-0" />
          <span>Nova versão v{d.latest} disponível</span>
          <span className="text-[var(--ink-muted)] font-medium">(instalada: v{d.current})</span>
        </div>
        <div className="flex items-center gap-2">
          {d.notes && (
            <button
              onClick={() => setShowNotes((v) => !v)}
              className="ds-btn ds-btn-slate ds-btn-sm"
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
            className="font-pixel text-[9px] px-2 py-1 text-[#5a4a1c] hover:underline cursor-pointer"
          >
            Depois
          </button>
        </div>
      </div>
      {showNotes && d.notes && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white border-2 border-[var(--border-dark)] p-2.5 font-sans text-[11px] leading-relaxed text-[#242b34]">
          {d.notes}
        </pre>
      )}
      {s.message?.tone === "error" && (
        <div className="mt-1.5 font-bold text-[#b4241c]">{s.message.text}</div>
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
    <section className="px-box p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-pixel text-sm text-[var(--ink)] flex items-center gap-2">
            <ArrowUpCircle className="w-5 h-5 text-[#e08218]" /> Atualizações (GitHub Releases)
          </h2>
          {d && (
            <p className="text-xs text-[var(--ink-muted)] font-semibold mt-1">
              Versão instalada: <b className="font-pixel text-[10px] text-[var(--ink)]">v{d.current}</b> · Repositório:{" "}
              <span className="font-mono">{d.repo}</span> · Última verificação:{" "}
              {formatCheckedAgo(d.checkedAt, serverTimeMs)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            disabled={s.checking || s.applying || !d?.enabled}
            onClick={() => void checkForUpdateNow()}
            className="ds-btn ds-btn-blue ds-btn-sm"
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
        <div className="text-xs text-[var(--ink-muted)]">Carregando informações de atualização…</div>
      )}

      {d && !d.enabled && (
        <div className="text-xs text-[var(--ink-muted)]">
          Verificação automática desativada neste computador (<code className="font-mono">UPDATE_CHECK=0</code>).
        </div>
      )}

      {d && d.enabled && d.available && d.latest && (
        <div className="rounded-lg bg-amber-500/12 border border-amber-600/35 p-3.5 space-y-2 text-xs text-[var(--ink)]">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="font-bold">
              Versão v{d.latest} pronta para instalar
              {d.installerName && (
                <span className="ml-2 font-mono text-[11px] opacity-75">
                  ({d.installerName})
                </span>
              )}
            </div>
            {d.url && (
              <a
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-[#a85a08] hover:underline inline-flex items-center gap-1"
              >
                Ver no GitHub <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {d.notes && (
            <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-white border-2 border-[var(--border-dark)] p-2.5 font-sans text-[11px] leading-relaxed text-[#242b34]">
              {d.notes}
            </pre>
          )}
          {!d.canApply && d.cannotApplyReason && (
            <div>{d.cannotApplyReason}</div>
          )}
          {d.canApply && (
            <div className="text-[11px] opacity-80">
              O instalador NSIS é verificado por SHA-256 e roda silenciosamente; suas contas e banco de dados em{" "}
              <code className="font-mono">%LOCALAPPDATA%\PokeMngr</code> são preservados.
            </div>
          )}
        </div>
      )}

      {d && d.enabled && !d.available && !s.message && !d.error && d.latest && (
        <div className="text-xs font-bold text-[var(--ink-accent-green)] inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> Você já está na versão mais recente (v{d.current}).
        </div>
      )}

      {s.message && (
        <div
          className={`text-xs font-bold ${
            s.message.tone === "ok"
              ? "text-[var(--ink-accent-green)]"
              : "text-[var(--ink-accent-rose)]"
          }`}
        >
          {s.message.text}
        </div>
      )}

      {!s.message && d?.error && (
        <div className="text-xs font-bold text-[var(--ink-accent-rose)]">{d.error}</div>
      )}
    </section>
  );
}
