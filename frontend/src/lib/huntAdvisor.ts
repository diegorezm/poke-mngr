import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ActivePokemonSheet } from "./types";

export type HuntOrder = "xp" | "ouro";

export interface HuntLine {
  slug: string;
  nome: string;
  regiao: string | null;
  nivel: number;
  liberada: boolean;
  inviavel: boolean;
  xpPokemonH: number;
  xpTreinadorH: number;
  ouroH: number;
  kph: number;
  mortesH: number;
  umHit: boolean;
  hitPct: number;
  melhorGolpe: { nome: string; tipo: string } | null;
}

interface WorkerResult {
  versao: string | null;
  total: number;
  linhas: HuntLine[];
}

export interface BestHunts {
  sheet: ActivePokemonSheet;
  lines: HuntLine[];
  versao: string | null;
}

export const lineMetric = (l: HuntLine, o: HuntOrder) =>
  o === "ouro" ? l.ouroH : l.xpPokemonH;

export const rankLines = (lines: HuntLine[] | undefined, order: HuntOrder) =>
  (lines ?? [])
    .filter((l) => l.liberada && !l.inviavel && lineMetric(l, order) > 0)
    .sort((a, b) => lineMetric(b, order) - lineMetric(a, order) || a.nivel - b.nivel);

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<
  number,
  { ok: (r: WorkerResult) => void; fail: (e: Error) => void }
>();

function failAll(msg: string) {
  for (const w of waiting.values()) w.fail(new Error(msg));
  waiting.clear();
  worker?.terminate();
  worker = null;
}

function runWorker(entrada: {
  sheet: ActivePokemonSheet;
  nivelTreinador: number;
}): Promise<WorkerResult> {
  if (!worker) {
    worker = new Worker(`${import.meta.env.BASE_URL}hunt-worker.js`, {
      type: "module",
    });
    worker.onmessage = (
      e: MessageEvent<{ id: number; ok: boolean; dados?: WorkerResult; erro?: string }>
    ) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.ok && e.data.dados) w.ok(e.data.dados);
      else w.fail(new Error(e.data.erro ?? "Falha no cálculo"));
    };
    worker.onerror = () =>
      failAll("Não consegui carregar a calculadora de hunt (PokéIdle Hub).");
  }
  const id = ++seq;
  return new Promise((ok, fail) => {
    waiting.set(id, { ok, fail });
    worker?.postMessage({ id, entrada });
  });
}

const cache = new Map<string, BestHunts>();
const keyOf = (s: ActivePokemonSheet) =>
  [
    s.speciesId,
    s.level,
    s.potencia,
    s.quality,
    s.shiny,
    s.trainerLevel,
    Object.values(s.stats || {}).join("-"),
  ].join("|");
const RECALC_MS = 45_000;

export function useBestHunts(accountId: number, trigger: string, enabled: boolean) {
  const [data, setData] = useState<BestHunts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const last = useRef({ acc: 0, at: 0 });
  const [nonce, setNonce] = useState(0);
  const reload = () => setNonce((n) => n + 1);

  useEffect(() => {
    if (!accountId || !enabled) return;
    let alive = true;
    const switched = last.current.acc !== accountId;
    if (switched) setData(null);
    const wait =
      switched || !last.current.at
        ? 250
        : Math.max(250, last.current.at + RECALC_MS - Date.now());

    const timer = setTimeout(async () => {
      try {
        const sheet = await api.getActivePokemonSheet(accountId);
        const key = keyOf(sheet);
        const hit = cache.get(key);
        if (hit) {
          if (alive) {
            setData(hit);
            setError(null);
          }
          return;
        }
        if (alive) setLoading(true);
        const r = await runWorker({ sheet, nivelTreinador: sheet.trainerLevel });
        const out: BestHunts = { sheet, lines: r.linhas, versao: r.versao };
        cache.set(key, out);
        if (cache.size > 12) {
          const first = cache.keys().next().value;
          if (first) cache.delete(first);
        }
        last.current = { acc: accountId, at: Date.now() };
        if (alive) {
          setData(out);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
      if (alive) setLoading(false);
    }, wait);

    last.current.acc = accountId;
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [accountId, trigger, enabled, nonce]);

  return { data, error, loading, reload };
}
