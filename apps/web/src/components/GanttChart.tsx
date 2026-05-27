"use client";
import { useMemo, useState } from "react";
import { CalendarX } from "lucide-react";
import type { Task, TaskStatus, TaskPriority, Dependency } from "@/lib/api/tasks";

const PX_PER_DAY = 28;
const ROW_H      = 46;
const HEADER_H   = 52;
const BAR_H      = 22;
const DIAMOND_R  = 10; // half-width of milestone diamond
const LABEL_W    = 280;

function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function daysBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// ── Color palette ─────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<TaskStatus, { bg: string; text: string; border: string }> = {
  todo:        { bg: "#94a3b8", text: "#fff",    border: "#64748b" },
  in_progress: { bg: "#3b82f6", text: "#fff",    border: "#2563eb" },
  blocked:     { bg: "#ef4444", text: "#fff",    border: "#dc2626" },
  review:      { bg: "#f59e0b", text: "#78350f", border: "#d97706" },
  done:        { bg: "#22c55e", text: "#fff",    border: "#16a34a" },
  cancelled:   { bg: "#cbd5e1", text: "#94a3b8", border: "#94a3b8" },
};

const PRIORITY_DOT: Record<TaskPriority, string> = {
  critical: "#ef4444", high: "#f59e0b", med: "#3b82f6", low: "#94a3b8",
};

// ── Timeline helpers ──────────────────────────────────────────────────────────
function monthsInRange(start: Date, end: Date) {
  const out: { label: string; left: number; width: number }[] = [];
  let cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= end) {
    const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const left  = Math.max(0, daysBetween(start, cur)) * PX_PER_DAY;
    const right = (Math.min(daysBetween(start, mEnd), daysBetween(start, end)) + 1) * PX_PER_DAY;
    out.push({ label: cur.toLocaleDateString("en-US", { month: "short", year: "numeric" }), left, width: Math.max(right - left, 0) });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return out;
}
function weeksInRange(start: Date, end: Date) {
  const out: { left: number; label: string }[] = [];
  let cur = new Date(start);
  const day = cur.getDay();
  if (day !== 1) cur = addDays(cur, (8 - day) % 7);
  while (cur <= end) {
    out.push({ left: daysBetween(start, cur) * PX_PER_DAY, label: cur.toLocaleDateString("en-US", { day: "2-digit" }) });
    cur = addDays(cur, 7);
  }
  return out;
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface GanttChartProps {
  tasks: Task[];
  deps?: Dependency[];
  onTaskClick?: (task: Task) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function GanttChart({ tasks, deps = [], onTaskClick }: GanttChartProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const dated = useMemo(
    () => tasks.filter(t => t.startDate && t.dueDate).sort((a, b) => a.startDate! > b.startDate! ? 1 : -1),
    [tasks],
  );
  const undated = tasks.filter(t => !t.startDate || !t.dueDate);

  const { rangeStart, totalDays } = useMemo(() => {
    if (!dated.length) return { rangeStart: new Date(), totalDays: 30 };
    const minD = new Date(Math.min(...dated.map(t => new Date(t.startDate!).getTime())));
    const maxD = new Date(Math.max(...dated.map(t => new Date(t.dueDate!).getTime())));
    return { rangeStart: addDays(minD, -4), totalDays: daysBetween(addDays(minD, -4), addDays(maxD, 4)) + 1 };
  }, [dated]);

  const rangeEnd  = addDays(rangeStart, totalDays - 1);
  const timelineW = totalDays * PX_PER_DAY;
  const today     = new Date();
  const todayLeft = daysBetween(rangeStart, today) * PX_PER_DAY;
  const months    = useMemo(() => monthsInRange(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const weeks     = useMemo(() => weeksInRange(rangeStart, rangeEnd), [rangeStart, rangeEnd]);
  const totalW    = LABEL_W + timelineW;

  // Precompute bar center-x and row center-y keyed by taskId
  const barPositions = useMemo(() => {
    const map = new Map<string, { cx: number; cy: number; rightX: number }>();
    dated.forEach((task, i) => {
      const isMilestone = task.type === "milestone";
      const dateLeft = daysBetween(rangeStart, new Date(task.startDate!)) * PX_PER_DAY;
      const barDays  = Math.max(1, daysBetween(new Date(task.startDate!), new Date(task.dueDate!)));
      const barWidth = isMilestone ? 0 : Math.max(12, barDays * PX_PER_DAY);
      const cx = isMilestone ? Math.max(DIAMOND_R, dateLeft) : Math.max(0, dateLeft) + barWidth / 2;
      const cy = i * ROW_H + ROW_H / 2;
      const rightX = isMilestone ? cx + DIAMOND_R : Math.max(0, dateLeft) + barWidth;
      map.set(task.id, { cx, cy, rightX });
    });
    return map;
  }, [dated, rangeStart]);

  // ── Empty states ──────────────────────────────────────────────────────────
  if (!tasks.length) return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-line py-16 text-center">
      <CalendarX size={28} className="text-ink-3" strokeWidth={1.5} />
      <p className="text-sm text-ink-3">No tasks in this project.</p>
    </div>
  );
  if (!dated.length) return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-line py-16 text-center">
      <CalendarX size={28} className="text-ink-3" strokeWidth={1.5} />
      <p className="text-sm text-ink-3">No tasks have start &amp; due dates yet.</p>
      <p className="text-xs text-ink-3">Open a task and set its Start &amp; Due dates.</p>
    </div>
  );

  const bodyH = dated.length * ROW_H + (undated.length > 0 ? 32 : 0);

  return (
    <div className="overflow-hidden rounded-md border border-line bg-paper shadow-xs">

      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 flex border-b border-line bg-surface" style={{ minWidth: totalW }}>
        <div className="shrink-0 flex items-center border-r border-line px-3" style={{ width: LABEL_W, height: HEADER_H }}>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-3">Task</span>
        </div>
        <div className="relative flex-1 overflow-hidden" style={{ width: timelineW, height: HEADER_H }}>
          {months.map((m, i) => (
            <div key={i} className="absolute top-0 flex items-center border-r border-line/60 px-2"
              style={{ left: m.left, width: m.width, height: 26 }}>
              <span className="truncate text-[10px] font-semibold text-ink-2">{m.label}</span>
            </div>
          ))}
          {weeks.map((w, i) => (
            <div key={i} className="absolute bottom-0" style={{ left: w.left, height: 26 }}>
              <div className="absolute inset-y-0 left-0 border-l border-line/40" />
              <span className="absolute left-1 top-1 text-[9px] text-ink-3">{w.label}</span>
            </div>
          ))}
          {todayLeft >= 0 && todayLeft <= timelineW && (
            <div className="absolute inset-y-0 z-10" style={{ left: todayLeft }}>
              <div className="absolute inset-y-0 border-l-2 border-accent" />
              <div className="absolute -top-1 rounded-full bg-accent shadow-sm" style={{ left: -5, width: 10, height: 10 }} />
            </div>
          )}
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: totalW }}>
          <div style={{ position: "relative", height: bodyH }}>

            {/* ── Row backgrounds + label column ────────────────────────── */}
            {dated.map((task, i) => {
              const isEven   = i % 2 === 0;
              const isHovered = hoveredId === task.id;
              return (
                <div
                  key={task.id}
                  className="absolute flex border-b border-line/30 transition-colors"
                  style={{
                    top: i * ROW_H, height: ROW_H, width: totalW,
                    background: isHovered
                      ? "color-mix(in srgb, #3b82f6 6%, var(--color-paper, #fff))"
                      : isEven ? "var(--color-paper, #fff)" : "var(--color-surface, #f8fafc)",
                  }}
                  onMouseEnter={() => setHoveredId(task.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  {/* Label cell */}
                  <div className="shrink-0 flex items-center gap-2 border-r border-line/50 px-3 overflow-hidden"
                    style={{ width: LABEL_W, height: ROW_H }}>
                    <span className="shrink-0 h-1.5 w-1.5 rounded-full"
                      style={{ background: PRIORITY_DOT[task.priority] ?? "#94a3b8" }} />
                    {task.type === "milestone" ? (
                      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-ink-3 bg-warning/15 border border-warning/30 rounded-xs px-1 py-0.5 leading-none">◆ MS</span>
                    ) : (
                      <span className="shrink-0 font-mono text-[9px] text-ink-3 bg-surface-2 border border-line rounded-xs px-1 py-0.5 leading-none">{task.code}</span>
                    )}
                    <span className="flex-1 truncate text-[12px] leading-tight" style={{ color: task.type === "milestone" ? "#92400e" : "var(--color-ink, #1e293b)" }} title={task.title}>
                      {task.title}
                    </span>
                  </div>
                  {/* Week grid lines (in timeline area only) */}
                  <div className="relative flex-1" style={{ height: ROW_H }}>
                    {weeks.map((w, wi) => (
                      <div key={wi} className="absolute inset-y-0 border-l border-line/20" style={{ left: w.left }} />
                    ))}
                  </div>
                </div>
              );
            })}

            {/* ── SVG overlay: dependency arrows + today line ───────────── */}
            <svg
              className="absolute inset-0 pointer-events-none overflow-visible"
              style={{ left: LABEL_W, top: 0, width: timelineW, height: bodyH }}
            >
              <defs>
                <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8" />
                </marker>
                <marker id="arrow-hover" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L6,3 z" fill="#3b82f6" />
                </marker>
              </defs>

              {/* Today line */}
              {todayLeft >= 0 && todayLeft <= timelineW && (
                <line x1={todayLeft} y1={0} x2={todayLeft} y2={bodyH}
                  stroke="#3b82f6" strokeWidth={2} strokeOpacity={0.3} />
              )}

              {/* Dependency arrows */}
              {deps.map(dep => {
                const from = barPositions.get(dep.predecessorId);
                const to   = barPositions.get(dep.successorId);
                if (!from || !to) return null;
                const x1 = from.rightX;
                const y1 = from.cy;
                const x2 = to.cx - DIAMOND_R - 2;
                const y2 = to.cy;
                const isHov = hoveredId === dep.predecessorId || hoveredId === dep.successorId;
                // Elbow path: right → down/up → right
                const midX = x1 + Math.max(12, (x2 - x1) * 0.5);
                const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
                return (
                  <path key={dep.id} d={d} fill="none"
                    stroke={isHov ? "#3b82f6" : "#94a3b8"}
                    strokeWidth={isHov ? 1.5 : 1}
                    strokeDasharray={isHov ? "none" : "4 3"}
                    markerEnd={isHov ? "url(#arrow-hover)" : "url(#arrow)"}
                    opacity={isHov ? 1 : 0.6}
                  />
                );
              })}

              {/* Milestone diamonds */}
              {dated.map((task, i) => {
                if (task.type !== "milestone") return null;
                const dateLeft = daysBetween(rangeStart, new Date(task.startDate!)) * PX_PER_DAY;
                const cx = Math.max(DIAMOND_R, dateLeft);
                const cy = i * ROW_H + ROW_H / 2;
                const col = STATUS_COLOR[task.status] ?? STATUS_COLOR.done;
                const isHov = hoveredId === task.id;
                const r = isHov ? DIAMOND_R + 2 : DIAMOND_R;
                return (
                  <g key={task.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => onTaskClick?.(task)}
                    onMouseEnter={() => setHoveredId(task.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {/* Glow */}
                    {isHov && (
                      <polygon
                        points={`${cx},${cy - r - 3} ${cx + r + 3},${cy} ${cx},${cy + r + 3} ${cx - r - 3},${cy}`}
                        fill={col.bg} opacity={0.2}
                      />
                    )}
                    {/* Diamond */}
                    <polygon
                      points={`${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`}
                      fill={col.bg}
                      stroke={col.border}
                      strokeWidth={1.5}
                    />
                    {/* Check mark for done */}
                    {task.status === "done" && (
                      <text x={cx} y={cy + 3.5} textAnchor="middle" fontSize={10} fill="#fff" fontWeight="bold">✓</text>
                    )}
                    {/* Tooltip title on hover */}
                    {isHov && (
                      <g>
                        <rect x={cx + r + 6} y={cy - 11} width={Math.min(task.title.length * 6.5 + 12, 180)} height={20}
                          rx={3} fill="white" stroke="#e2e8f0" strokeWidth={1} />
                        <text x={cx + r + 12} y={cy + 3} fontSize={10} fill="#1e293b">
                          {task.title.length > 26 ? task.title.slice(0, 25) + "…" : task.title}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Regular bar overlays (bars are clickable, placed on SVG for uniform hover) */}
              {dated.map((task, i) => {
                if (task.type === "milestone") return null;
                const barStart = daysBetween(rangeStart, new Date(task.startDate!));
                const barDays  = Math.max(1, daysBetween(new Date(task.startDate!), new Date(task.dueDate!)));
                const barLeft  = Math.max(0, barStart * PX_PER_DAY);
                const barWidth = Math.max(12, barDays * PX_PER_DAY);
                const pct      = task.progressPct ?? 0;
                const col      = STATUS_COLOR[task.status] ?? STATUS_COLOR.todo;
                const cy       = i * ROW_H + ROW_H / 2;
                const barTop   = cy - BAR_H / 2;
                const isHov    = hoveredId === task.id;

                return (
                  <g key={task.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => onTaskClick?.(task)}
                    onMouseEnter={() => setHoveredId(task.id)}
                    onMouseLeave={() => setHoveredId(null)}
                  >
                    {/* Track */}
                    <rect x={barLeft} y={barTop} width={barWidth} height={BAR_H}
                      rx={4} fill={col.bg} opacity={0.18} />
                    {/* Bar */}
                    <rect x={barLeft} y={barTop} width={barWidth} height={BAR_H}
                      rx={4} fill={col.bg}
                      stroke={col.border} strokeWidth={0.75} strokeOpacity={0.5}
                      filter={isHov ? "drop-shadow(0 2px 6px rgba(0,0,0,0.18))" : undefined}
                    />
                    {/* Progress fill */}
                    {pct > 0 && (
                      <rect x={barLeft} y={barTop} width={barWidth * (pct / 100)} height={BAR_H}
                        rx={4} fill="rgba(255,255,255,0.28)" />
                    )}
                    {/* Label inside bar */}
                    {barWidth > 56 && (
                      <text x={barLeft + 8} y={cy + 4}
                        fontSize={10} fontWeight={500} fill={col.text}
                        clipPath={`inset(0 0 0 ${barLeft + 8}px)`}
                        style={{ userSelect: "none", pointerEvents: "none" }}>
                        {task.title.length > Math.floor(barWidth / 7) ? task.title.slice(0, Math.floor(barWidth / 7) - 1) + "…" : task.title}
                      </text>
                    )}
                    {/* Progress % badge on hover */}
                    {isHov && pct > 0 && (
                      <g>
                        <rect x={barLeft + barWidth * (pct / 100) - 14} y={barTop - 18}
                          width={28} height={14} rx={3} fill="white" stroke="#e2e8f0" strokeWidth={1} />
                        <text x={barLeft + barWidth * (pct / 100)} y={barTop - 7}
                          textAnchor="middle" fontSize={9} fill="#64748b" fontWeight={600}>
                          {pct}%
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>

            {/* Undated tasks footer row */}
            {undated.length > 0 && (
              <div className="absolute flex border-t border-dashed border-line/40"
                style={{ top: dated.length * ROW_H, height: 32, width: totalW }}>
                <div className="flex items-center gap-1.5 px-3 text-[10px] text-ink-3" style={{ width: LABEL_W }}>
                  <span className="font-mono text-[9px] bg-surface-2 border border-line rounded-xs px-1">+{undated.length}</span>
                  <span>task{undated.length > 1 ? "s" : ""} without dates</span>
                </div>
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-3 border-t border-line bg-surface px-4 py-2.5">
            {(Object.entries(STATUS_COLOR) as [TaskStatus, typeof STATUS_COLOR[TaskStatus]][])
              .filter(([s]) => s !== "cancelled")
              .map(([s, c]) => (
                <div key={s} className="flex items-center gap-1.5">
                  <span className="h-2.5 w-5 rounded-xs shadow-xs" style={{ background: c.bg }} />
                  <span className="text-[10px] capitalize text-ink-3">{s.replace("_", " ")}</span>
                </div>
              ))}
            <div className="flex items-center gap-2 ml-2 border-l border-line pl-3">
              <div className="flex items-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 14 14">
                  <polygon points="7,1 13,7 7,13 1,7" fill="#f59e0b" stroke="#d97706" strokeWidth="1.5" />
                </svg>
                <span className="text-[10px] text-ink-3">Milestone</span>
              </div>
              <div className="flex items-center gap-1.5">
                <svg width="24" height="10" viewBox="0 0 24 10">
                  <line x1="0" y1="5" x2="18" y2="5" stroke="#94a3b8" strokeWidth="1" strokeDasharray="4 3" />
                  <polygon points="18,2 24,5 18,8" fill="#94a3b8" />
                </svg>
                <span className="text-[10px] text-ink-3">Dependency</span>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="h-3 w-0 border-l-2 border-accent" />
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="text-[10px] text-ink-3">Today</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
