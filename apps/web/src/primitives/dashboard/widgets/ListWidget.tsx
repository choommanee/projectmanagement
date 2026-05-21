export function ListWidget({ title, items }: { title?: string; items: { label: string; meta?: string }[] }) {
  // Compute total + max for visual proportion bars
  const numericMetas = items.map((it) => Number(it.meta)).filter((n) => Number.isFinite(n));
  const max = numericMetas.length ? Math.max(...numericMetas, 1) : 0;
  const total = numericMetas.reduce((a, b) => a + b, 0);

  return (
    <div className="group relative h-full overflow-hidden rounded-md border border-line-strong bg-surface shadow-xs transition-all hover:border-accent/40 hover:shadow-md">
      {/* Corner ticks */}
      <span aria-hidden className="pointer-events-none absolute left-2 top-2 h-1.5 w-1.5 border-l border-t border-line-strong" />
      <span aria-hidden className="pointer-events-none absolute right-2 top-2 h-1.5 w-1.5 border-r border-t border-line-strong" />

      {title && (
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
            <span className="inline-block h-1 w-1 rounded-full bg-accent" />
            <span className="truncate">{title}</span>
          </div>
          {total > 0 && (
            <span className="font-mono text-[10px] tabular-nums text-ink-3">Σ {total}</span>
          )}
        </div>
      )}
      <ul className="overflow-auto" style={{ maxHeight: title ? "calc(100% - 40px)" : "100%" }}>
        {items.length === 0 ? (
          <li className="px-4 py-6 text-center font-mono text-[10px] uppercase tracking-widest text-ink-3">
            ◇ no data
          </li>
        ) : items.map((it, i) => {
          const n = Number(it.meta);
          const pct = max > 0 && Number.isFinite(n) ? Math.max(2, (n / max) * 100) : 0;
          return (
            <li
              key={i}
              className="group/row relative flex items-center justify-between border-b border-line/60 px-4 py-2 text-[13px] last:border-0 hover:bg-paper"
            >
              {/* Proportion bar (subtle) */}
              {pct > 0 && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-accent-soft transition-colors group-hover/row:bg-accent/15"
                  style={{ width: `${pct}%` }}
                />
              )}
              <span className="relative truncate text-ink">{it.label}</span>
              {it.meta && (
                <span className="relative font-mono text-[11px] font-semibold tabular-nums text-ink">{it.meta}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
