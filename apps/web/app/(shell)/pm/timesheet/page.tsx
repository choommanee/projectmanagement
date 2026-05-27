"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, Clock, TrendingUp, Save } from "lucide-react";
import { Button, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listAllTasks, type Task } from "@/lib/api/tasks";
import { listProjects, type Project } from "@/lib/api/projects";
import { listWorklogs, createWorklog, type WorklogEntry } from "@/lib/api/worklog";

// ─── Date helpers ─────────────────────────────────────────────────────────────

function weekMonday(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}
function isToday(d: Date) {
  return toDateStr(d) === toDateStr(new Date());
}
function fmtShortDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtWeekRange(mon: Date) {
  const fri = addDays(mon, 4);
  if (mon.getMonth() === fri.getMonth()) {
    return `${mon.toLocaleDateString("en-US", { month: "long" })} ${mon.getDate()}–${fri.getDate()}, ${fri.getFullYear()}`;
  }
  return `${fmtShortDate(mon)} – ${fmtShortDate(fri)}, ${fri.getFullYear()}`;
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const CAPACITY_MD = 1.0; // 1 man-day per working day

// ─── KPI tile ─────────────────────────────────────────────────────────────────

function KpiTile({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "success" | "warning" | "info";
}) {
  const tones = {
    neutral: "bg-paper border-line",
    success: "bg-success/5 border-success/20",
    warning: "bg-warning/5 border-warning/20",
    info:    "bg-accent/5 border-accent/20",
  };
  return (
    <div className={`flex items-start gap-3 rounded-md border px-4 py-3 ${tones[tone]}`}>
      <div className="mt-0.5 text-ink-3">{icon}</div>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-3">{label}</p>
        <p className="mt-0.5 font-mono text-xl tabular-nums text-ink">{value}</p>
        {sub && <p className="text-[11px] text-ink-3">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Utilization bar ──────────────────────────────────────────────────────────

function UtilBar({ pct }: { pct: number }) {
  const clamped = Math.min(pct, 120);
  const color = pct >= 100 ? "bg-warning" : pct >= 80 ? "bg-success" : "bg-accent";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-2">
        {/* eslint-disable-next-line react/forbid-dom-props -- dynamic progress bar width requires inline style */}
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(clamped, 100)}%` }} />
      </div>
      <span className="font-mono text-[11px] text-ink-3">{pct.toFixed(0)}%</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TimesheetPage() {
  const { user } = useAuth();

  const [tasks, setTasks]         = useState<Task[]>([]);
  const [projects, setProjects]   = useState<Map<string, Project>>(new Map());
  const [logs, setLogs]           = useState<WorklogEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [editing, setEditing]     = useState<Record<string, string>>({});
  const [saving, setSaving]       = useState<Set<string>>(new Set());
  const [saved, setSaved]         = useState<Set<string>>(new Set());
  const [saveError, setSaveError] = useState<Record<string, string>>({});
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const [notes, setNotes]         = useState<Record<string, string>>({});

  const monday      = useMemo(() => addDays(weekMonday(new Date()), weekOffset * 7), [weekOffset]);
  const weekDates   = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(monday, i)), [monday]);
  const weekDateStrs = useMemo(() => weekDates.map(toDateStr), [weekDates]);

  // ── Load data ───────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [taskRes, projRes] = await Promise.all([
        listAllTasks({ limit: 200 }),
        listProjects({ limit: 100 }),
      ]);

      const active = taskRes.items.filter(
        t => t.status !== "done" && t.status !== "cancelled",
      );

      const projMap = new Map<string, Project>();
      for (const p of projRes.items) projMap.set(p.id, p);

      const allLogs = await Promise.all(
        active.map(t => listWorklogs(t.id).catch(() => [] as WorklogEntry[])),
      );

      setTasks(active);
      setProjects(projMap);
      setLogs(allLogs.flat());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Log map & totals ───────────────────────────────────────────────────────

  const logMap = useMemo(() => {
    const m = new Map<string, WorklogEntry>();
    for (const log of logs) {
      const date = log.workDate.slice(0, 10);
      m.set(`${log.taskId}|${date}`, log);
    }
    return m;
  }, [logs]);

  const noteMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const log of logs) {
      if (log.note) m.set(`${log.taskId}|${log.workDate.slice(0, 10)}`, log.note);
    }
    return m;
  }, [logs]);

  const dayTotals = useMemo(() =>
    weekDateStrs.map(d =>
      [...logMap.values()]
        .filter(l => l.workDate.slice(0, 10) === d)
        .reduce((s, l) => s + l.loggedMd, 0),
    ),
  [logMap, weekDateStrs]);

  const weekTotal = dayTotals.reduce((s, t) => s + t, 0);
  const capacity  = 5 * CAPACITY_MD;
  const utilPct   = capacity > 0 ? (weekTotal / capacity) * 100 : 0;

  const taskWeekTotal = (taskId: string) =>
    weekDateStrs.reduce((s, d) => s + (logMap.get(`${taskId}|${d}`)?.loggedMd ?? 0), 0);

  // ── Save handler ───────────────────────────────────────────────────────────

  async function handleSave(task: Task, date: string) {
    const key = `${task.id}|${date}`;
    const raw = editing[key];
    if (raw === undefined) return;

    const md = parseFloat(raw);
    if (isNaN(md) || md < 0) {
      setEditing(e => { const n = { ...e }; delete n[key]; return n; });
      return;
    }

    setSaving(s => new Set(s).add(key));
    setSaveError(e => { const n = { ...e }; delete n[key]; return n; });

    try {
      const entry = await createWorklog(task.id, {
        userId:    user?.id ?? "",
        loggedMd:  md,
        workDate:  date,
        note:      notes[key] ?? noteMap.get(key) ?? "",
      });
      setLogs(prev => {
        const filtered = prev.filter(l => !(l.taskId === task.id && l.workDate.slice(0, 10) === date));
        return [...filtered, entry];
      });
      setSaved(s => { const n = new Set(s); n.add(key); return n; });
      setTimeout(() => setSaved(s => { const n = new Set(s); n.delete(key); return n; }), 1500);
    } catch (e) {
      setSaveError(err => ({ ...err, [key]: e instanceof Error ? e.message : "Error" }));
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(key); return n; });
      setEditing(ed => { const n = { ...ed }; delete n[key]; return n; });
    }
  }

  const cellValue = (taskId: string, date: string) => {
    const key = `${taskId}|${date}`;
    if (editing[key] !== undefined) return editing[key];
    const md = logMap.get(key)?.loggedMd;
    return md != null && md > 0 ? md.toFixed(2).replace(/\.?0+$/, "") : "";
  };

  // ── Group tasks by project ─────────────────────────────────────────────────

  const grouped = useMemo(() => {
    const g = new Map<string, Task[]>();
    for (const t of tasks) {
      const list = g.get(t.projectId) ?? [];
      list.push(t);
      g.set(t.projectId, list);
    }
    return g;
  }, [tasks]);

  // ─────────────────────────────────────────────────────────────────────────────

  const breadcrumb = [{ label: "Home", href: "/pm/home" }, { label: "Timesheet" }];

  return (
    <div className="flex h-full flex-col overflow-auto">
      <Breadcrumb items={breadcrumb} />

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-line bg-linear-to-r from-paper via-surface to-paper px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-ink">Weekly Timesheet</h1>
            <p className="mt-0.5 text-xs text-ink-3">
              {user?.displayName ?? "—"} · {fmtWeekRange(monday)}
            </p>
          </div>

          {/* Week nav */}
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(o => o - 1)}>
              <ChevronLeft size={14} />
            </Button>
            <span className="min-w-40 text-center text-[13px] font-medium text-ink">
              {fmtWeekRange(monday)}
            </span>
            <Button variant="ghost" size="sm" onClick={() => setWeekOffset(o => o + 1)}>
              <ChevronRight size={14} />
            </Button>
            {weekOffset !== 0 && (
              <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)} className="ml-1 text-accent">
                Today
              </Button>
            )}
          </div>
        </div>

        {/* KPI strip */}
        {!loading && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile
              icon={<Clock size={15} />}
              label="Logged this week"
              value={`${weekTotal.toFixed(1)} md`}
              sub={`${(weekTotal * 8).toFixed(0)} hours`}
              tone={weekTotal >= capacity ? "success" : weekTotal >= capacity * 0.6 ? "info" : "neutral"}
            />
            <KpiTile
              icon={<CalendarDays size={15} />}
              label="Working days"
              value={`${weekDates.filter(d => dayTotals[weekDates.indexOf(d)] > 0).length} / 5`}
              sub="days with entries"
            />
            <KpiTile
              icon={<TrendingUp size={15} />}
              label="Utilization"
              value={`${utilPct.toFixed(0)}%`}
              sub={`of ${capacity.toFixed(0)} md capacity`}
              tone={utilPct >= 80 ? "success" : utilPct >= 50 ? "info" : "warning"}
            />
            <KpiTile
              icon={<Save size={15} />}
              label="Tasks tracked"
              value={`${tasks.filter(t => taskWeekTotal(t.id) > 0).length}`}
              sub={`of ${tasks.length} active tasks`}
            />
          </div>
        )}
      </div>

      {/* ── Grid ────────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-4">
        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-ink-3">Loading timesheet…</div>
        ) : tasks.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-sm text-ink-3">
            <CalendarDays size={32} className="opacity-30" />
            <p>No active tasks found. Assign tasks to yourself first.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full text-xs">

              {/* Header */}
              <thead>
                <tr className="bg-surface-2">
                  <th className="w-64 px-4 py-2.5 text-left font-semibold text-ink-3">Task</th>
                  {weekDates.map((d, i) => {
                    const today = isToday(d);
                    return (
                      <th
                        key={toDateStr(d)}
                        className={`min-w-22 px-2 py-2 text-center font-semibold ${today ? "bg-accent/8 text-accent" : "text-ink-3"}`}
                      >
                        <div className="text-[11px]">{DAY_LABELS[i]}</div>
                        <div className={`text-[10px] font-normal ${today ? "text-accent" : "text-ink-3"}`}>
                          {fmtShortDate(d)}
                        </div>
                        {today && (
                          <div className="mx-auto mt-0.5 h-1 w-1 rounded-full bg-accent" />
                        )}
                      </th>
                    );
                  })}
                  <th className="px-3 py-2.5 text-right font-semibold text-ink-3">Total</th>
                  <th className="w-20 px-3 py-2.5 text-left font-semibold text-ink-3">Est.</th>
                </tr>
              </thead>

              <tbody>
                {[...grouped.entries()].map(([projectId, pTasks]) => {
                  const proj = projects.get(projectId);
                  return (
                    <React.Fragment key={projectId}>
                      {/* Project group header */}
                      <tr className="bg-surface-2/60">
                        <td
                          colSpan={8}
                          className="border-t border-line px-4 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3"
                        >
                          {proj?.name ?? "Unknown Project"}
                        </td>
                      </tr>

                      {pTasks.map(task => {
                        const weekTot = taskWeekTotal(task.id);
                        const hasLogs = weekTot > 0;
                        return (
                          <React.Fragment key={task.id}>
                            {/* Task row */}
                            <tr
                              className={`border-t border-line transition-colors hover:bg-surface-2/40 ${hasLogs ? "bg-accent/3" : ""}`}
                            >
                              {/* Task info */}
                              <td className="px-4 py-2">
                                <div className="flex items-start gap-2">
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-mono text-[10px] text-ink-3">{task.code}</span>
                                      <Tag tone="neutral">{task.status}</Tag>
                                    </div>
                                    <div className="mt-0.5 truncate font-medium text-ink leading-tight max-w-55" title={task.title}>
                                      {task.title}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Day cells */}
                              {weekDateStrs.map(date => {
                                const key = `${task.id}|${date}`;
                                const isSaving  = saving.has(key);
                                const isSaved   = saved.has(key);
                                const hasErr    = !!saveError[key];
                                const hasValue  = (logMap.get(key)?.loggedMd ?? 0) > 0;
                                const today     = date === toDateStr(new Date());

                                let cellBg = "";
                                if (today) cellBg = "bg-accent/5";
                                else if (hasValue) cellBg = "bg-success/5";

                                return (
                                  <td key={date} className={`px-2 py-1.5 ${cellBg}`}>
                                    <div className="relative">
                                      <input
                                        type="number"
                                        min="0"
                                        max="3"
                                        step="0.25"
                                        value={cellValue(task.id, date)}
                                        onChange={e => setEditing(ed => ({ ...ed, [key]: e.target.value }))}
                                        onBlur={() => handleSave(task, date)}
                                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                        disabled={isSaving}
                                        placeholder="—"
                                        className={[
                                          "w-full rounded border px-1 py-1.5 text-center font-mono text-xs transition-colors",
                                          "focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15",
                                          isSaving ? "animate-pulse opacity-50 bg-surface-2 border-line" :
                                          isSaved  ? "border-success/60 bg-success/10 text-success" :
                                          hasErr   ? "border-danger/50 bg-danger/5" :
                                          hasValue ? "border-accent/30 bg-paper text-ink" :
                                                     "border-line bg-surface-2 text-ink-3",
                                        ].join(" ")}
                                      />
                                      {hasErr && (
                                        <div className="absolute -bottom-4 left-0 z-10 whitespace-nowrap rounded bg-danger px-1 py-0.5 text-[9px] text-white">
                                          {saveError[key]}
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}

                              {/* Week total */}
                              <td className="px-3 py-2 text-right">
                                <span className={`font-mono font-semibold ${weekTot > 0 ? "text-ink" : "text-ink-3"}`}>
                                  {weekTot > 0 ? weekTot.toFixed(1) : "—"}
                                </span>
                              </td>

                              {/* Estimate */}
                              <td className="px-3 py-2">
                                <span className="font-mono text-ink-3">
                                  {task.estimateMd > 0 ? `${task.estimateMd}d` : "—"}
                                </span>
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  );
                })}

                {/* Totals row */}
                <tr className="border-t-2 border-line bg-surface-2 font-semibold">
                  <td className="px-4 py-2.5 text-[11px] font-semibold text-ink-2">Daily Total</td>
                  {dayTotals.map((t, i) => {
                    const today = isToday(weekDates[i]);
                    const pct = t / CAPACITY_MD;
                    return (
                      <td key={i} className={`px-2 py-2 text-center ${today ? "bg-accent/8" : ""}`}>
                        <div className={`font-mono text-xs font-semibold ${t > 0 ? "text-ink" : "text-ink-3"}`}>
                          {t > 0 ? t.toFixed(1) : "—"}
                        </div>
                        {t > 0 && (
                          <div className="mt-1 flex justify-center">
                            <UtilBar pct={pct * 100} />
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2.5 text-right font-mono text-sm text-ink">
                    {weekTotal.toFixed(1)}
                  </td>
                  <td className="px-3 py-2.5 text-ink-3 text-[11px]">
                    {capacity}d cap
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-[11px] text-ink-3">
          Enter man-days (0.0–3.0) per cell · press Enter or click away to save · 1 md = 8 h
        </p>
      </div>
    </div>
  );
}
