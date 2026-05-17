export function ListWidget({ title, items }: { title?: string; items: { label: string }[] }) {
  return (
    <div className="h-full overflow-auto rounded-md border border-border bg-bg p-3">
      <div className="text-xs text-fgMuted">{title}</div>
      <ul className="mt-1 space-y-1 text-sm">
        {items.map((it, i) => <li key={i}>{it.label}</li>)}
      </ul>
    </div>
  );
}
