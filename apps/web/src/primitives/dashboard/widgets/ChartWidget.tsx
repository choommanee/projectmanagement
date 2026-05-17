export function ChartWidget({ title, data }: { title?: string; data?: number[] }) {
  const bars = data ?? [42, 35, 48, 51, 62, 58, 67, 72, 65, 70, 78, 82];
  const max = Math.max(...bars);
  const svgH = 80;
  const gap = 4;
  const barW = Math.max(4, Math.floor((300 - gap * (bars.length - 1)) / bars.length));
  const totalW = bars.length * barW + gap * (bars.length - 1);

  return (
    <div className="flex h-full flex-col rounded-md border border-line bg-surface shadow-xs">
      <div className="border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {title ?? "Chart"}
      </div>
      <div className="flex flex-1 items-end px-4 pb-4 pt-6">
        <svg
          viewBox={`0 0 ${totalW} ${svgH}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
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
                rx={2}
                fill={isLast ? "var(--signal)" : "var(--accent)"}
                opacity={0.85}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
