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
  const w = 72, h = 28;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return { x, y, str: `${x.toFixed(1)},${y.toFixed(1)}` };
  });
  const linePts = pts.map((p) => p.str).join(" ");
  const areaD = `M0,${h} L${pts.map((p) => p.str).join(" L")} L${w},${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={areaD} fill="var(--accent)" opacity="0.08" />
      <polyline fill="none" stroke="var(--accent)" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" points={linePts} />
      <circle cx={last.x} cy={last.y} r={2} fill="var(--accent)" />
    </svg>
  );
}

export function KpiTile({ title, value, sub, delta, spark }: Props) {
  return (
    <div className="group relative flex h-full flex-col justify-between overflow-hidden rounded-md border border-line-strong bg-surface p-4 shadow-xs transition-all hover:border-accent/40 hover:shadow-md">
      {/* Corner tick marks (instrument-panel detail) */}
      <span aria-hidden className="pointer-events-none absolute left-2 top-2 h-1.5 w-1.5 border-l border-t border-line-strong" />
      <span aria-hidden className="pointer-events-none absolute right-2 top-2 h-1.5 w-1.5 border-r border-t border-line-strong" />
      <span aria-hidden className="pointer-events-none absolute bottom-2 left-2 h-1.5 w-1.5 border-b border-l border-line-strong" />
      <span aria-hidden className="pointer-events-none absolute bottom-2 right-2 h-1.5 w-1.5 border-b border-r border-line-strong" />

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
          <span className="inline-block h-1 w-1 rounded-full bg-accent" />
          <span className="truncate">{title}</span>
        </div>
        {spark && <Sparkline data={spark} />}
      </div>

      <div className="mt-2 flex items-baseline gap-2">
        <div className="font-mono text-[30px] font-semibold leading-none tabular-nums text-ink">
          {value}
        </div>
        {delta !== undefined && (
          <span
            className={`inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold tabular-nums ${
              delta >= 0 ? "text-success" : "text-danger"
            }`}
          >
            {delta >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {delta >= 0 ? "+" : ""}{delta}
          </span>
        )}
      </div>

      {sub && <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">{sub}</div>}
    </div>
  );
}
