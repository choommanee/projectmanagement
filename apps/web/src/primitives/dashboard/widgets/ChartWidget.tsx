export function ChartWidget({ title }: { title?: string }) {
  return (
    <div className="h-full rounded-md border border-border bg-bg p-3">
      <div className="text-xs text-fgMuted">{title ?? "Chart"}</div>
      <div className="mt-2 grid h-[calc(100%-1.5rem)] place-items-center text-fgMuted">[chart]</div>
    </div>
  );
}
