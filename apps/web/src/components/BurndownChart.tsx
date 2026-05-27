"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface BurndownChartProps {
  sprint: { startDate?: string | null; endDate?: string | null; name?: string | null };
  tasks: Array<{ estimateMd?: number | null; status: string; updatedAt?: string | null }>;
}

// Return array of Date objects from start to end inclusive
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

export function BurndownChart({ sprint, tasks }: BurndownChartProps) {
  if (!sprint.startDate || tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 font-mono text-[11px] text-ink-3">
        No tasks to chart
      </div>
    );
  }

  const activeTasks = tasks.filter((t) => t.status !== "cancelled");
  const total = activeTasks.length;
  const completed = activeTasks.filter((t) => t.status === "done").length;
  const remaining = total - completed;

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-32 font-mono text-[11px] text-ink-3">
        No active tasks to chart
      </div>
    );
  }

  const sprintStart = new Date(sprint.startDate);
  sprintStart.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sprintEnd = sprint.endDate ? new Date(sprint.endDate) : today;
  sprintEnd.setHours(0, 0, 0, 0);

  // Actual line goes from start to min(today, sprintEnd)
  const actualEnd = today <= sprintEnd ? today : sprintEnd;

  const allDays = dateRange(sprintStart, sprintEnd);
  const actualDays = dateRange(sprintStart, actualEnd);

  if (allDays.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 font-mono text-[11px] text-ink-3">
        Invalid sprint dates
      </div>
    );
  }

  // For each task that is done, determine which day it was completed
  const doneDates = activeTasks.map((t) => {
    if (t.status === "done") {
      if (t.updatedAt) {
        const d = new Date(t.updatedAt);
        d.setHours(0, 0, 0, 0);
        return toDateOnly(d);
      }
      return toDateOnly(actualEnd);
    }
    return null;
  });

  // Build actual data: count remaining (not-done) tasks for each day
  const actualByDay: Record<string, number> = {};
  for (const day of actualDays) {
    const dayStr = toDateOnly(day);
    let rem = 0;
    activeTasks.forEach((t, i) => {
      const doneDate = doneDates[i];
      if (doneDate === null || doneDate > dayStr) {
        rem += 1;
      }
    });
    actualByDay[dayStr] = rem;
  }

  // Build chart data array spanning full sprint
  const totalDays = allDays.length - 1;
  const chartData = allDays.map((day, idx) => {
    const dayStr = toDateOnly(day);
    const ideal = totalDays === 0 ? 0 : Math.round(total - (total * idx) / totalDays);
    const actual = actualByDay[dayStr] !== undefined ? actualByDay[dayStr] : undefined;
    return {
      day: fmtLabel(day),
      ideal,
      actual,
    };
  });

  const sprintDays = allDays.length;

  return (
    <div className="border border-line bg-paper rounded-sm p-3">
      {/* Summary row */}
      <div className="flex items-center gap-4 mb-3 font-mono text-[10px] text-ink-3">
        <span>Sprint: <span className="text-ink">{sprintDays}</span> days</span>
        <span>Total tasks: <span className="text-ink">{total}</span></span>
        <span>Completed: <span className="text-success">{completed}</span></span>
        <span>Remaining: <span className="text-ink">{remaining}</span></span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 10, fill: "var(--color-ink-3)", fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "var(--color-ink-3)", fontFamily: "var(--font-mono)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--color-line)" }}
            allowDecimals={false}
            domain={[0, total]}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-paper)",
              border: "1px solid var(--color-line)",
              borderRadius: 2,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--color-ink)",
            }}
            labelStyle={{ color: "var(--color-ink-2)", marginBottom: 2 }}
            itemStyle={{ color: "var(--color-ink-2)" }}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            iconSize={8}
          />
          <Line
            type="linear"
            dataKey="ideal"
            name="Ideal"
            stroke="var(--color-ink-3)"
            strokeDasharray="4 2"
            strokeWidth={1.5}
            dot={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="actual"
            name="Actual"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={{ r: 2.5, fill: "var(--color-accent)", strokeWidth: 0 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
