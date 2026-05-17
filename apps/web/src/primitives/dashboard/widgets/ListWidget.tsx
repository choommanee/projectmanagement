export function ListWidget({ title, items }: { title?: string; items: { label: string; meta?: string }[] }) {
  return (
    <div className="h-full overflow-hidden rounded-md border border-line bg-surface shadow-xs">
      {title && <div className="border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</div>}
      <ul className="overflow-auto" style={{ maxHeight: "calc(100% - 36px)" }}>
        {items.map((it, i) => (
          <li key={i} className="flex items-center justify-between border-b border-line/60 px-4 py-2 text-[13px] last:border-0 hover:bg-surface-2">
            <span className="text-ink">{it.label}</span>
            {it.meta && <span className="font-mono text-[11px] text-ink-3">{it.meta}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
