"use client";

export interface ChartWidgetProps {
  title: string;
  type: "bar" | "line";
  data: { label: string; value: number }[];
  loading?: boolean;
}

const CHART_H = 120;
const CHART_PAD_LEFT = 36;
const CHART_PAD_BOTTOM = 24;
const CHART_PAD_RIGHT = 8;
const CHART_PAD_TOP = 8;

export function ChartWidget({ title, type, data, loading }: ChartWidgetProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface p-4">
        <div className="h-3 w-24 animate-pulse rounded-xs bg-surface-2" />
        <div className="h-32 w-full animate-pulse rounded-xs bg-surface-2" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface p-4">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-3">{title}</span>
        <div className="flex h-32 items-center justify-center text-xs text-ink-3">No data</div>
      </div>
    );
  }

  const maxVal = Math.max(...data.map(d => d.value), 1);
  const innerW = 300; // SVG viewBox width
  const innerH = CHART_H - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const innerX = CHART_PAD_LEFT;
  const innerY = CHART_PAD_TOP;
  const slotW  = (innerW - CHART_PAD_LEFT - CHART_PAD_RIGHT) / data.length;
  const barW   = Math.max(4, slotW * 0.55);

  // Y axis ticks (3 levels)
  const ticks = [0, Math.round(maxVal / 2), maxVal];

  function toY(v: number) {
    return innerY + innerH - (v / maxVal) * innerH;
  }

  function toX(i: number) {
    return innerX + i * slotW + slotW / 2;
  }

  const linePath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${toX(i)} ${toY(d.value)}`)
    .join(" ");

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-surface p-4">
      {/* Title */}
      <span className="text-xs font-medium uppercase tracking-wider text-ink-3">{title}</span>

      {/* SVG chart */}
      <svg
        viewBox={`0 0 ${innerW} ${CHART_H}`}
        className="w-full"
        role="img"
        aria-label={`${title} ${type} chart`}
      >
        {/* Y-axis ticks + gridlines */}
        {ticks.map(tick => {
          const y = toY(tick);
          return (
            <g key={tick}>
              <line
                x1={innerX}
                y1={y}
                x2={innerW - CHART_PAD_RIGHT}
                y2={y}
                stroke="currentColor"
                strokeWidth="0.5"
                strokeDasharray="2 3"
                className="text-line"
              />
              <text
                x={innerX - 4}
                y={y + 3}
                textAnchor="end"
                fontSize="7"
                className="fill-current text-ink-3"
                style={{ fontFamily: "monospace" }}
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {data.map((d, i) => (
          <text
            key={i}
            x={toX(i)}
            y={CHART_H - 4}
            textAnchor="middle"
            fontSize="7"
            className="fill-current text-ink-3"
          >
            {d.label.length > 6 ? d.label.slice(0, 5) + "…" : d.label}
          </text>
        ))}

        {/* Bars or line */}
        {type === "bar"
          ? data.map((d, i) => {
              const bh = (d.value / maxVal) * innerH;
              return (
                <rect
                  key={i}
                  x={toX(i) - barW / 2}
                  y={toY(d.value)}
                  width={barW}
                  height={bh}
                  rx="1"
                  className="fill-accent opacity-80"
                />
              );
            })
          : (
            <>
              <path
                d={linePath}
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="stroke-accent"
              />
              {data.map((d, i) => (
                <circle
                  key={i}
                  cx={toX(i)}
                  cy={toY(d.value)}
                  r="2.5"
                  className="fill-accent stroke-surface"
                  strokeWidth="1"
                />
              ))}
            </>
          )}
      </svg>
    </div>
  );
}
