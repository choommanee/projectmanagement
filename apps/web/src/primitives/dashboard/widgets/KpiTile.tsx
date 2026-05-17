import { TrendingUp, TrendingDown } from "lucide-react";

interface Props {
  title: string;
  value: string | number;
  sub?: string;
  delta?: number;
  spark?: number[];
}

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 64, h = 24;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={pts} />
    </svg>
  );
}

export function KpiTile({ title, value, sub, delta, spark }: Props) {
  return (
    <div className="flex h-full flex-col justify-between rounded-md border border-line bg-surface p-4 shadow-xs transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">{title}</div>
        {spark && <Sparkline data={spark} />}
      </div>
      <div className="mt-2 font-mono text-[28px] font-semibold tabular-nums leading-none text-ink">{value}</div>
      {(sub || delta !== undefined) && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-ink-3">
          {delta !== undefined && (
            <span className={`inline-flex items-center gap-0.5 font-medium ${delta >= 0 ? "text-success" : "text-danger"}`}>
              {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {delta >= 0 ? "+" : ""}{delta}
            </span>
          )}
          {sub && <span>{sub}</span>}
        </div>
      )}
    </div>
  );
}
