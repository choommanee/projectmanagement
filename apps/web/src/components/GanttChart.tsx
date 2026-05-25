"use client";
import { useMemo } from "react";
import type { Task, TaskStatus } from "@/lib/api/tasks";

const PX_PER_DAY = 26;
const ROW_H = 36;
const LABEL_W = 220;

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function statusBar(status: TaskStatus): string {
  switch (status) {
    case "in_progress": return "bg-accent";
    case "done":        return "bg-success";
    case "blocked":     return "bg-danger";
    case "review":      return "bg-warning";
    case "cancelled":   return "bg-line opacity-50";
    default:            return "bg-line-strong";
  }
}

function monthsInRange(start: Date, end: Date): { label: string; left: number; width: number }[] {
  const months: { label: string; left: number; width: number }[] = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const monthEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const left = Math.max(0, daysBetween(start, cur)) * PX_PER_DAY;
    const width =
      (Math.min(daysBetween(start, monthEnd), daysBetween(start, end)) -
        Math.max(0, daysBetween(start, cur)) +
        1) *
      PX_PER_DAY;
    months.push({
      label: cur.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      left,
      width: Math.max(width, 0),
    });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return months;
}

function weeksInRange(start: Date, end: Date): { left: number }[] {
  const weeks: { left: number }[] = [];
  let cur = new Date(start);
  const day = cur.getDay();
  if (day !== 1) cur = addDays(cur, (8 - day) % 7);
  while (cur <= end) {
    weeks.push({ left: daysBetween(start, cur) * PX_PER_DAY });
    cur = addDays(cur, 7);
  }
  return weeks;
}

interface GanttChartProps {
  tasks: Task[];
  onTaskClick?: (task: Task) => void;
}

export function GanttChart({ tasks, onTaskClick }: GanttChartProps) {
  const dated = useMemo(
    () =>
      tasks
        .filter((t) => t.startDate && t.dueDate)
        .sort((a, b) => (a.startDate! > b.startDate! ? 1 : -1)),
    [tasks],
  );
  const undated = tasks.filter((t) => !t.startDate || !t.dueDate);

  const { rangeStart, totalDays } = useMemo(() => {
    if (dated.length === 0) return { rangeStart: new Date(), totalDays: 30 };
    const starts = dated.map((t) => new Date(t.startDate!).getTime());
    const ends = dated.map((t) => new Date(t.dueDate!).getTime());
    const minD = new Date(Math.min(...starts));
    const maxD = new Date(Math.max(...ends));
    const start = addDays(minD, -3);
    const end = addDays(maxD, 3);
    return { rangeStart: start, totalDays: daysBetween(start, end) + 1 };
  }, [dated]);

  const rangeEnd = addDays(rangeStart, totalDays - 1);
  const timelineW = totalDays * PX_PER_DAY;
  const today = new Date();
  const todayLeft = daysBetween(rangeStart, today) * PX_PER_DAY;
  const months = useMemo(() => monthsInRange(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const weeks = useMemo(() => weeksInRange(rangeStart, rangeEnd), [rangeStart, rangeEnd]);

  if (tasks.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-ink-3">
        No tasks in this project.
      </div>
    );
  }

  if (dated.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-ink-3">
        No tasks have start &amp; due dates set. Edit tasks to add dates.
      </div>
    );
  }

  const totalRows = dated.length + (undated.length > 0 ? 1 : 0);
  const chartH = totalRows * ROW_H + 48;

  return (
    <div className="overflow-x-auto border border-line rounded-xs bg-paper">
      <div style={{ minWidth: LABEL_W + timelineW }} className="text-xs">

        {/* Header row */}
        <div className="flex sticky top-0 z-10 bg-surface border-b border-line">
          <div
            className="shrink-0 flex items-end px-3 py-1.5 border-r border-line text-[10px] font-semibold text-ink-3 uppercase tracking-wide"
            style={{ width: LABEL_W }}
          >
            Task
          </div>
          <div className="relative overflow-hidden" style={{ width: timelineW, height: 48 }}>
            {months.map((m, i) => (
              <div
                key={i}
                className="absolute top-0 flex items-center px-2 h-6 text-[10px] font-semibold text-ink-2 border-r border-line"
                style={{ left: m.left, width: m.width }}
              >
                {m.label}
              </div>
            ))}
            {weeks.map((w, i) => (
              <div
                key={i}
                className="absolute top-6 bottom-0 border-l border-line/50"
                style={{ left: w.left }}
              />
            ))}
            {todayLeft >= 0 && todayLeft <= timelineW && (
              <div
                className="absolute top-0 bottom-0 border-l-2 border-accent/60"
                style={{ left: todayLeft }}
              />
            )}
          </div>
        </div>

        {/* Task rows */}
        <div style={{ height: chartH - 48 }}>
          {dated.map((task, i) => {
            const barStart = daysBetween(rangeStart, new Date(task.startDate!));
            const barDays = Math.max(1, daysBetween(new Date(task.startDate!), new Date(task.dueDate!)));
            const barLeft = barStart * PX_PER_DAY;
            const barWidth = barDays * PX_PER_DAY;
            const isEven = i % 2 === 0;

            return (
              <div
                key={task.id}
                className={`flex items-center border-b border-line/40 ${isEven ? "" : "bg-surface-2/30"}`}
                style={{ height: ROW_H }}
              >
                <div
                  className="shrink-0 flex items-center gap-2 px-3 border-r border-line overflow-hidden"
                  style={{ width: LABEL_W, height: ROW_H }}
                >
                  <span className="font-mono text-[9px] text-ink-3 shrink-0 w-12 truncate">{task.code}</span>
                  <span className="text-[11px] text-ink truncate leading-tight flex-1" title={task.title}>
                    {task.title}
                  </span>
                </div>

                <div className="relative" style={{ width: timelineW, height: ROW_H }}>
                  {weeks.map((w, wi) => (
                    <div
                      key={wi}
                      className="absolute inset-y-0 border-l border-line/30"
                      style={{ left: w.left }}
                    />
                  ))}
                  {todayLeft >= 0 && todayLeft <= timelineW && (
                    <div
                      className="absolute inset-y-0 border-l-2 border-accent/40"
                      style={{ left: todayLeft }}
                    />
                  )}
                  <button
                    type="button"
                    title={`${task.title} — ${task.startDate?.slice(0, 10)} → ${task.dueDate?.slice(0, 10)}`}
                    onClick={() => onTaskClick?.(task)}
                    className={`absolute top-1/2 -translate-y-1/2 rounded-xs h-5 min-w-2 cursor-pointer hover:brightness-110 transition-all ${statusBar(task.status)}`}
                    style={{ left: Math.max(0, barLeft), width: Math.max(8, barWidth) }}
                  >
                    {barWidth > 60 && (
                      <span className="px-1.5 text-[9px] font-medium text-white truncate block leading-5">
                        {task.title}
                      </span>
                    )}
                  </button>
                  {task.progressPct > 0 && barWidth > 8 && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 h-5 rounded-xs opacity-30 bg-white pointer-events-none"
                      style={{
                        left: Math.max(Math.max(0, barLeft), barLeft + barWidth * ((task.progressPct ?? 0) / 100)),
                        width: barWidth * (1 - (task.progressPct ?? 0) / 100),
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}

          {undated.length > 0 && (
            <div
              className="flex items-center border-b border-line/40 bg-surface-2/20"
              style={{ height: ROW_H }}
            >
              <div className="px-3 text-[10px] text-ink-3 italic" style={{ width: LABEL_W }}>
                +{undated.length} task{undated.length > 1 ? "s" : ""} without dates
              </div>
              <div style={{ width: timelineW }} />
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 px-3 py-2 border-t border-line bg-surface text-[10px] text-ink-3">
          {(["todo", "in_progress", "blocked", "review", "done"] as TaskStatus[]).map((s) => (
            <div key={s} className="flex items-center gap-1">
              <span className={`w-2.5 h-2.5 rounded-xs ${statusBar(s)}`} />
              <span>{s.replace("_", " ")}</span>
            </div>
          ))}
          <div className="flex items-center gap-1 ml-auto">
            <span className="w-px h-3 border-l-2 border-accent/60" />
            <span>today</span>
          </div>
        </div>

      </div>
    </div>
  );
}
