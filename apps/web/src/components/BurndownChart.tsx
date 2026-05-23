"use client";

interface BurndownChartProps {
  sprint: { startDate?: string | null; endDate?: string | null; capacity?: number | null };
  tasks: Array<{ estimateMd?: number | null; status: string; updatedAt?: string | null }>;
}

// Return array of date strings (YYYY-MM-DD) from start to end inclusive
function dateRange(start: Date, end: Date): Date[] {
  const days: Date[] = [];
  const cur = new Date(start);
  cur.setHours(0, 0, 0, 0);
  const endNorm = new Date(end);
  endNorm.setHours(0, 0, 0, 0);
  while (cur <= endNorm) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const PAD_L = 28;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 24;
const W = 500;
const H = 200;
const CHART_W = W - PAD_L - PAD_R;
const CHART_H = H - PAD_T - PAD_B;

export function BurndownChart({ sprint, tasks }: BurndownChartProps) {
  if (!sprint.startDate || tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 font-mono text-[11px] text-ink-3">
        No tasks to chart
      </div>
    );
  }

  const sprintStart = new Date(sprint.startDate);
  sprintStart.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sprintEnd = sprint.endDate ? new Date(sprint.endDate) : today;
  sprintEnd.setHours(0, 0, 0, 0);

  // Chart ends at min(today, sprintEnd)
  const actualEnd = today <= sprintEnd ? today : sprintEnd;

  const days = dateRange(sprintStart, sprintEnd);
  if (days.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 font-mono text-[11px] text-ink-3">
        No tasks to chart
      </div>
    );
  }

  const totalEstimate = tasks.reduce((s, t) => s + (t.estimateMd ?? 0), 0);
  if (totalEstimate === 0) {
    return (
      <div className="flex items-center justify-center h-32 font-mono text-[11px] text-ink-3">
        No tasks to chart
      </div>
    );
  }

  // Build actual burndown: remaining estimate for each day from start to min(today, sprintEnd)
  const actualDays = dateRange(sprintStart, actualEnd);

  // For each task, determine the date it moved to "done"
  const doneDates = tasks.map((t) => {
    if (t.status === "done" || t.status === "cancelled") {
      if (t.updatedAt) {
        const d = new Date(t.updatedAt);
        d.setHours(0, 0, 0, 0);
        return toDateOnly(d);
      }
      return toDateOnly(actualEnd); // fallback: treat as done today
    }
    return null; // not done
  });

  const actualPoints: { day: Date; remaining: number }[] = actualDays.map((day) => {
    const dayStr = toDateOnly(day);
    let remaining = 0;
    tasks.forEach((t, i) => {
      const est = t.estimateMd ?? 0;
      if (est === 0) return;
      const doneDate = doneDates[i];
      if (doneDate === null || doneDate > dayStr) {
        // Not yet done on this day
        remaining += est;
      }
    });
    return { day, remaining };
  });

  // Ideal line: from totalEstimate on day 0 to 0 on last day
  const totalDays = days.length - 1; // number of intervals

  // Map value to SVG x coordinate
  function xOf(dayIndex: number): number {
    return PAD_L + (totalDays === 0 ? 0 : (dayIndex / totalDays) * CHART_W);
  }

  // Map remaining to SVG y coordinate
  function yOf(remaining: number): number {
    return PAD_T + CHART_H - (totalEstimate === 0 ? 0 : (remaining / totalEstimate) * CHART_H);
  }

  // Ideal line points (start → end)
  const idealPath = `M ${xOf(0)} ${yOf(totalEstimate)} L ${xOf(totalDays)} ${yOf(0)}`;

  // Actual line points
  const actualPath = actualPoints.map((p, i) => {
    const dayIndex = days.findIndex((d) => toDateOnly(d) === toDateOnly(p.day));
    const x = xOf(dayIndex >= 0 ? dayIndex : i);
    const y = yOf(p.remaining);
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");

  // Dot positions for actual line
  const dots = actualPoints.map((p, i) => {
    const dayIndex = days.findIndex((d) => toDateOnly(d) === toDateOnly(p.day));
    return {
      x: xOf(dayIndex >= 0 ? dayIndex : i),
      y: yOf(p.remaining),
      remaining: p.remaining,
    };
  });

  // X-axis labels: start, mid (if > 7 days), end
  const xLabels: { dayIndex: number; label: string }[] = [
    { dayIndex: 0, label: fmtLabel(days[0]) },
  ];
  if (days.length > 7) {
    const midIdx = Math.floor(days.length / 2);
    xLabels.push({ dayIndex: midIdx, label: fmtLabel(days[midIdx]) });
  }
  xLabels.push({ dayIndex: days.length - 1, label: fmtLabel(days[days.length - 1]) });

  return (
    <div className="border border-line bg-paper rounded-sm p-4">
      <div className="font-mono text-[10px] text-ink-3 uppercase tracking-wider mb-2">Burndown</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 160 }}
        aria-label="Sprint burndown chart"
      >
        {/* Y-axis labels */}
        <text
          x={PAD_L - 4}
          y={PAD_T + 4}
          textAnchor="end"
          className="font-mono"
          fontSize={10}
          fill="var(--color-ink-3)"
        >
          {totalEstimate}
        </text>
        <text
          x={PAD_L - 4}
          y={PAD_T + CHART_H}
          textAnchor="end"
          className="font-mono"
          fontSize={10}
          fill="var(--color-ink-3)"
        >
          0
        </text>

        {/* Ideal line */}
        <path
          d={idealPath}
          stroke="var(--color-ink-3)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          fill="none"
        />

        {/* Actual line */}
        {actualPoints.length > 0 && (
          <path
            d={actualPath}
            stroke="var(--color-accent)"
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}

        {/* Dots on actual line */}
        {dots.map((dot, i) => (
          <circle
            key={i}
            cx={dot.x}
            cy={dot.y}
            r={2.5}
            fill="var(--color-accent)"
          />
        ))}

        {/* X-axis baseline */}
        <line
          x1={PAD_L}
          y1={PAD_T + CHART_H}
          x2={PAD_L + CHART_W}
          y2={PAD_T + CHART_H}
          stroke="var(--color-line)"
          strokeWidth={1}
        />

        {/* X-axis labels */}
        {xLabels.map(({ dayIndex, label }) => (
          <text
            key={dayIndex}
            x={xOf(dayIndex)}
            y={H - 6}
            textAnchor={dayIndex === 0 ? "start" : dayIndex === days.length - 1 ? "end" : "middle"}
            fontSize={10}
            fill="var(--color-ink-3)"
          >
            {label}
          </text>
        ))}
      </svg>
    </div>
  );
}
