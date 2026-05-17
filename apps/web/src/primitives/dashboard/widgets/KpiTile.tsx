export function KpiTile({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div className="flex h-full flex-col justify-center rounded-md border border-border bg-bg p-3">
      <div className="text-xs text-fgMuted">{title}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-fgMuted">{sub}</div>}
    </div>
  );
}
