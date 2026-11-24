import { fmtCompact } from "../lib/types";

export interface InflationPoint {
  day: string;
  index: number;
}

export interface PriceSeriesPoint {
  day: string;
  median: number;
  p25: number;
  p75: number;
  sales: number;
  units: number;
}

function shortDay(day: string): string {
  const parts = day.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`;
  return day;
}

export function Sparkline({
  values,
  positive,
}: {
  values: number[];
  positive: boolean;
}) {
  if (values.length < 2) return null;
  const w = 72;
  const h = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 4) + 2;
      const y = h - 3 - ((v - min) / span) * (h - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const stroke = positive ? "#34d399" : "#fb7185";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-[72px] h-[22px] shrink-0">
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
}

export function InflationChart({
  points,
  moedaLabel,
}: {
  points: InflationPoint[];
  moedaLabel: string;
}) {
  if (points.length < 2) {
    return (
      <div className="rounded-xl bg-[#0b0e1b] border border-slate-800 p-4 text-xs text-slate-500">
        Sem pontos suficientes de inflação para {moedaLabel} neste período.
      </div>
    );
  }
  const w = 640;
  const h = 150;
  const padX = 36;
  const padY = 18;
  const vals = points.map((p) => p.index);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const first = vals[0];
  const last = vals[vals.length - 1];
  const changePct = first > 0 ? ((last / first - 1) * 100) : 0;
  const isUp = changePct >= 0;

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * (w - padX * 2);
    const y = h - padY - ((p.index - min) / span) * (h - padY * 2);
    return { x, y, day: p.day, val: p.index };
  });
  const linePts = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const areaPts = `${coords[0].x.toFixed(1)},${h - padY} ${linePts} ${coords[coords.length - 1].x.toFixed(1)},${h - padY}`;
  const stroke = isUp ? "#f59e0b" : "#38bdf8";

  return (
    <div className="rounded-2xl bg-[#0b0e1b] border border-slate-800 p-4 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <div className="font-semibold text-white">
          Índice de Inflação — Itens ({moedaLabel})
        </div>
        <span
          className={`font-mono font-bold px-2 py-0.5 rounded-md ${
            isUp
              ? "bg-amber-500/15 text-amber-300"
              : "bg-sky-500/15 text-sky-300"
          }`}
        >
          {isUp ? "+" : ""}
          {changePct.toFixed(1)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-36">
        <line x1={padX} y1={padY} x2={w - padX} y2={padY} stroke="#1e293b" strokeDasharray="3 3" />
        <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} stroke="#1e293b" />
        <polygon points={areaPts} fill={stroke} fillOpacity="0.14" />
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth="2.2"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={linePts}
        />
        {coords.map((c, idx) => (
          <circle key={idx} cx={c.x} cy={c.y} r="2.6" fill={stroke}>
            <title>{`${shortDay(c.day)}: ${c.val.toFixed(2)}`}</title>
          </circle>
        ))}
        <text x={padX - 4} y={padY + 3} textAnchor="end" fontSize="9" fill="#64748b">
          {max.toFixed(1)}
        </text>
        <text x={padX - 4} y={h - padY + 3} textAnchor="end" fontSize="9" fill="#64748b">
          {min.toFixed(1)}
        </text>
        <text x={padX} y={h - 4} textAnchor="start" fontSize="9" fill="#64748b">
          {shortDay(points[0].day)}
        </text>
        <text x={w - padX} y={h - 4} textAnchor="end" fontSize="9" fill="#64748b">
          {shortDay(points[points.length - 1].day)}
        </text>
      </svg>
    </div>
  );
}

export function PriceSeriesChart({
  title,
  moedaLabel,
  points,
  loading,
  onClose,
}: {
  title: string;
  moedaLabel: string;
  points: PriceSeriesPoint[];
  loading: boolean;
  onClose: () => void;
}) {
  const w = 640;
  const h = 175;
  const padX = 50;
  const padY = 20;

  let content = (
    <div className="py-8 text-center text-xs text-slate-500">
      Sem histórico de vendas suficiente para {title} em {moedaLabel}.
    </div>
  );

  if (loading) {
    content = (
      <div className="py-8 text-center text-xs text-slate-400">
        Carregando série histórica de {title}...
      </div>
    );
  } else if (points.length >= 2) {
    const lows = points.map((p) => p.p25 || p.median);
    const highs = points.map((p) => p.p75 || p.median);
    const min = Math.min(...lows);
    const max = Math.max(...highs);
    const span = max - min || 1;
    const xAt = (i: number) => padX + (i / (points.length - 1)) * (w - padX - 16);
    const yAt = (v: number) => h - padY - ((v - min) / span) * (h - padY * 2);

    const medPts = points
      .map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.median).toFixed(1)}`)
      .join(" ");
    const bandTop = points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.p75 || p.median).toFixed(1)}`);
    const bandBot = points
      .map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.p25 || p.median).toFixed(1)}`)
      .reverse();
    const bandPoly = [...bandTop, ...bandBot].join(" ");
    const latest = points[points.length - 1];
    const totalSales = points.reduce((s, p) => s + p.sales, 0);

    content = (
      <div className="space-y-1.5">
        <div className="flex items-center gap-4 text-[11px] text-slate-400">
          <span>
            Última mediana:{" "}
            <b className="font-mono text-amber-300">
              {fmtCompact(latest.median)} {moedaLabel}
            </b>
          </span>
          <span>
            Faixa P25–P75:{" "}
            <b className="font-mono text-slate-200">
              {fmtCompact(latest.p25)} – {fmtCompact(latest.p75)}
            </b>
          </span>
          <span>
            Vendas no período: <b className="font-mono text-emerald-300">{totalSales}</b>
          </span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-44">
          <line x1={padX} y1={padY} x2={w - 16} y2={padY} stroke="#1e293b" strokeDasharray="3 3" />
          <line x1={padX} y1={h / 2} x2={w - 16} y2={h / 2} stroke="#1e293b" strokeDasharray="3 3" />
          <line x1={padX} y1={h - padY} x2={w - 16} y2={h - padY} stroke="#1e293b" />
          <polygon points={bandPoly} fill="#6366f1" fillOpacity="0.22" />
          <polyline
            fill="none"
            stroke="#fbbf24"
            strokeWidth="2.4"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={medPts}
          />
          {points.map((p, i) => (
            <circle key={p.day} cx={xAt(i)} cy={yAt(p.median)} r="3" fill="#fbbf24">
              <title>{`${shortDay(p.day)}: mediana ${fmtCompact(p.median)} (${p.sales} vendas)`}</title>
            </circle>
          ))}
          <text x={padX - 6} y={padY + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
            {fmtCompact(max)}
          </text>
          <text x={padX - 6} y={h / 2 + 3} textAnchor="end" fontSize="9" fill="#64748b">
            {fmtCompact((min + max) / 2)}
          </text>
          <text x={padX - 6} y={h - padY + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
            {fmtCompact(min)}
          </text>
          <text x={padX} y={h - 4} textAnchor="start" fontSize="9" fill="#64748b">
            {shortDay(points[0].day)}
          </text>
          <text x={w - 16} y={h - 4} textAnchor="end" fontSize="9" fill="#64748b">
            {shortDay(points[points.length - 1].day)}
          </text>
        </svg>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-[#0b0e1b] border border-indigo-500/35 p-4 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <div className="font-semibold text-indigo-200">
          Histórico de Preços — {title} ({moedaLabel})
        </div>
        <button
          onClick={onClose}
          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300"
        >
          Fechar
        </button>
      </div>
      {content}
    </div>
  );
}
