"use client";

export interface SprintVelocity {
  sprintName: string;
  planned: number; // estimateMd sum
  actual: number;  // actualMd sum
}

interface Props {
  data: SprintVelocity[];
}

const PAD_L = 40;
const PAD_R = 16;
const PAD_T = 12;
const PAD_B = 44;
const CHART_H = 160;
const BAR_W = 20;
const BAR_GAP = 6;
const GROUP_PAD = 20;

export function VelocityChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 font-mono text-[11px] text-ink-3">
        No sprint data yet
      </div>
    );
  }

  const maxVal = Math.max(...data.flatMap((d) => [d.planned, d.actual]), 1);
  const groupW = BAR_W * 2 + BAR_GAP + GROUP_PAD;
  const svgW = PAD_L + data.length * groupW + PAD_R;
  const svgH = CHART_H + PAD_T + PAD_B;

  function xBar(groupIndex: number, barIndex: number): number {
    return PAD_L + groupIndex * groupW + barIndex * (BAR_W + BAR_GAP);
  }

  function yBar(value: number): number {
    return PAD_T + CHART_H - (value / maxVal) * CHART_H;
  }

  function barH(value: number): number {
    return (value / maxVal) * CHART_H;
  }

  // Y gridlines at 4 levels
  const gridLevels = [0, 0.25, 0.5, 0.75, 1.0];

  return (
    <div className="border border-line bg-paper rounded-sm p-4">
      <div className="font-mono text-[10px] text-ink-3 uppercase tracking-wider mb-3">Velocity (mandays)</div>
      <div className="overflow-x-auto">
        <svg
          width={svgW}
          height={svgH}
          aria-label="Sprint velocity chart"
          style={{ minWidth: svgW }}
        >
          {/* Y gridlines + labels */}
          {gridLevels.map((frac) => {
            const y = PAD_T + CHART_H * (1 - frac);
            return (
              <g key={frac}>
                <line
                  x1={PAD_L}
                  x2={svgW - PAD_R}
                  y1={y}
                  y2={y}
                  stroke="var(--color-line)"
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 4}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={9}
                  fill="var(--color-ink-3)"
                  fontFamily="monospace"
                >
                  {(maxVal * frac).toFixed(1)}
                </text>
              </g>
            );
          })}

          {/* Bars */}
          {data.map((d, i) => {
            const xP = xBar(i, 0);
            const xA = xBar(i, 1);
            const pH = barH(d.planned);
            const aH = barH(d.actual);
            const xCenter = xP + BAR_W + BAR_GAP / 2;
            return (
              <g key={i}>
                {/* Planned bar */}
                <rect
                  x={xP}
                  y={yBar(d.planned)}
                  width={BAR_W}
                  height={Math.max(pH, d.planned > 0 ? 2 : 0)}
                  fill="var(--color-accent)"
                  opacity={0.5}
                  rx={2}
                />
                {/* Actual bar */}
                <rect
                  x={xA}
                  y={yBar(d.actual)}
                  width={BAR_W}
                  height={Math.max(aH, d.actual > 0 ? 2 : 0)}
                  fill="var(--color-success)"
                  opacity={0.8}
                  rx={2}
                />
                {/* Sprint label */}
                <text
                  x={xCenter}
                  y={PAD_T + CHART_H + 14}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--color-ink-3)"
                  fontFamily="monospace"
                >
                  {d.sprintName.length > 8 ? d.sprintName.slice(0, 8) + "…" : d.sprintName}
                </text>
                {/* Value labels above bars */}
                {d.planned > 0 && (
                  <text
                    x={xP + BAR_W / 2}
                    y={yBar(d.planned) - 3}
                    textAnchor="middle"
                    fontSize={8}
                    fill="var(--color-accent)"
                    fontFamily="monospace"
                  >
                    {d.planned.toFixed(1)}
                  </text>
                )}
                {d.actual > 0 && (
                  <text
                    x={xA + BAR_W / 2}
                    y={yBar(d.actual) - 3}
                    textAnchor="middle"
                    fontSize={8}
                    fill="var(--color-success)"
                    fontFamily="monospace"
                  >
                    {d.actual.toFixed(1)}
                  </text>
                )}
              </g>
            );
          })}

          {/* X-axis baseline */}
          <line
            x1={PAD_L}
            x2={svgW - PAD_R}
            y1={PAD_T + CHART_H}
            y2={PAD_T + CHART_H}
            stroke="var(--color-line)"
            strokeWidth={1}
          />

          {/* Legend */}
          <g transform={`translate(${PAD_L}, ${svgH - 14})`}>
            <rect width={10} height={10} fill="var(--color-accent)" opacity={0.5} rx={1} />
            <text x={14} y={9} fontSize={9} fill="var(--color-ink-3)" fontFamily="monospace">Planned</text>
            <rect x={60} width={10} height={10} fill="var(--color-success)" opacity={0.8} rx={1} />
            <text x={74} y={9} fontSize={9} fill="var(--color-ink-3)" fontFamily="monospace">Actual</text>
          </g>
        </svg>
      </div>
    </div>
  );
}
