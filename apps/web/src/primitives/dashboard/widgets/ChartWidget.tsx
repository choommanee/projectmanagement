export function ChartWidget({ title, data }: { title?: string; data?: number[] }) {
  const bars = data ?? [42, 35, 48, 51, 62, 58, 67, 72, 65, 70, 78, 82];
  const max = Math.max(...bars, 1);
  const min = Math.min(...bars);
  const svgH = 100;
  const gap = 3;
  const barW = Math.max(3, Math.floor((400 - gap * (bars.length - 1)) / bars.length));
  const totalW = bars.length * barW + gap * (bars.length - 1);
  const last = bars[bars.length - 1];
  const lastDelta = bars.length > 1 ? bars[bars.length - 1] - bars[bars.length - 2] : 0;

  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-md border border-line-strong bg-surface shadow-xs transition-all hover:border-accent/40 hover:shadow-md">
      {/* Corner ticks */}
      <span aria-hidden className="pointer-events-none absolute left-2 top-2 h-1.5 w-1.5 border-l border-t border-line-strong" />
      <span aria-hidden className="pointer-events-none absolute right-2 top-2 h-1.5 w-1.5 border-r border-t border-line-strong" />
      <span aria-hidden className="pointer-events-none absolute bottom-2 left-2 h-1.5 w-1.5 border-b border-l border-line-strong" />
      <span aria-hidden className="pointer-events-none absolute bottom-2 right-2 h-1.5 w-1.5 border-b border-r border-line-strong" />

      {/* Header strip */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
          <span className="inline-block h-1 w-1 rounded-full bg-accent" />
          <span className="truncate">{title ?? "Chart"}</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] tabular-nums text-ink-3">
          <span>max·{max}</span>
          <span>min·{min}</span>
          <span className={lastDelta >= 0 ? "text-success" : "text-danger"}>
            Δ{lastDelta >= 0 ? "+" : ""}{lastDelta}
          </span>
        </div>
      </div>

      {/* Plot area */}
      <div className="relative flex flex-1 items-end px-4 pb-4 pt-4">
        {/* Y-axis gridlines (3 lines) */}
        <div aria-hidden className="pointer-events-none absolute inset-x-4 inset-y-4 flex flex-col justify-between">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-px w-full bg-line" />
          ))}
        </div>

        <svg
          viewBox={`0 0 ${totalW} ${svgH}`}
          preserveAspectRatio="none"
          className="relative h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.95" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.55" />
            </linearGradient>
            <linearGradient id="bar-grad-signal" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--signal)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--signal)" stopOpacity="0.6" />
            </linearGradient>
          </defs>
          {bars.map((v, i) => {
            const barH = Math.round((v / max) * svgH);
            const x = i * (barW + gap);
            const isLast = i === bars.length - 1;
            return (
              <rect
                key={i}
                x={x}
                y={svgH - barH}
                width={barW}
                height={barH}
                rx={1.5}
                fill={isLast ? "url(#bar-grad-signal)" : "url(#bar-grad)"}
              />
            );
          })}
        </svg>
      </div>

      {/* Footer: last value */}
      <div className="flex items-center justify-between border-t border-line px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
        <span>n·{bars.length}</span>
        <span className="text-ink">latest <span className="tabular-nums text-signal">{last}</span></span>
      </div>
    </div>
  );
}
