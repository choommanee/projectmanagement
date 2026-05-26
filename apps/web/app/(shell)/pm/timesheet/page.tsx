"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listAllTasks, type Task } from "@/lib/api/tasks";
import { listWorklogs, createWorklog, type WorklogEntry } from "@/lib/api/worklog";

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
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

export default function TimesheetPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [logs, setLogs] = useState<WorklogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const monday = useMemo(() => addDays(weekMonday(new Date()), weekOffset * 7), [weekOffset]);
  const weekDates = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(monday, i)), [monday]);
  const weekDateStrs = useMemo(() => weekDates.map(toDateStr), [weekDates]);

  useEffect(() => {
    listAllTasks({ limit: 200 }).then(r => {
      const active = r.items.filter(t => t.status !== "done" && t.status !== "cancelled");
      setTasks(active);
      return Promise.all(active.map(t => listWorklogs(t.id).catch(() => [])));
    }).then(allLogs => {
      setLogs(allLogs.flat());
    }).finally(() => setLoading(false));
  }, []);

  const logMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const log of logs) {
      m.set(`${log.taskId}|${log.workDate}`, log.loggedMd);
    }
    return m;
  }, [logs]);

  const dayTotals = useMemo(() =>
    weekDateStrs.map(d =>
      [...logMap.entries()]
        .filter(([k]) => k.endsWith(`|${d}`))
        .reduce((s, [, v]) => s + v, 0)
    ),
    [logMap, weekDateStrs]
  );

  const taskWeekTotal = (taskId: string) =>
    weekDateStrs.reduce((s, d) => s + (logMap.get(`${taskId}|${d}`) ?? 0), 0);

  const editKey = (taskId: string, date: string) => `${taskId}|${date}`;

  async function handleBlur(task: Task, date: string) {
    const key = editKey(task.id, date);
    const raw = editing[key];
    if (raw === undefined) return;
    const md = parseFloat(raw);
    if (isNaN(md) || md < 0) {
      setEditing(e => { const n = { ...e }; delete n[key]; return n; });
      return;
    }
    setSaving(key);
    try {
      const entry = await createWorklog(task.id, {
        userId: "",
        loggedMd: md,
        workDate: date,
        note: "",
      });
      setLogs(prev => {
        const filtered = prev.filter(l => !(l.taskId === task.id && l.workDate === date));
        return [...filtered, entry];
      });
    } catch {
      // noop
    } finally {
      setSaving(null);
      setEditing(e => { const n = { ...e }; delete n[key]; return n; });
    }
  }

  const cellValue = (taskId: string, date: string): string => {
    const key = editKey(taskId, date);
    if (editing[key] !== undefined) return editing[key];
    const md = logMap.get(key);
    return md != null && md > 0 ? md.toFixed(1) : "";
  };

  return (
    <div className="p-6 space-y-4">
      <Breadcrumb items={[{ label: "PM" }, { label: "Timesheet" }]} />

      <div className="flex items-center gap-3">
        <button onClick={() => setWeekOffset(o => o - 1)} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">← Prev Week</button>
        <span className="text-sm font-medium">
          {monday.toLocaleDateString("en", { month: "short", day: "numeric" })} –{" "}
          {addDays(monday, 4).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
        </span>
        <button onClick={() => setWeekOffset(o => o + 1)} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Next Week →</button>
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} className="px-3 py-1.5 text-xs rounded border border-border text-accent hover:bg-accent/10">This Week</button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-64">Task</th>
                {weekDates.map((d, i) => (
                  <th key={toDateStr(d)} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground min-w-[80px]">
                    <div>{DAYS[i]}</div>
                    <div className="font-normal">{d.toLocaleDateString("en", { month: "short", day: "numeric" })}</div>
                  </th>
                ))}
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No active tasks</td></tr>
              )}
              {tasks.map(task => (
                <tr key={task.id} className="border-t border-border hover:bg-muted/10">
                  <td className="px-4 py-2">
                    <div className="font-mono text-xs text-muted-foreground">{task.code}</div>
                    <div className="text-xs font-medium leading-tight">{task.title}</div>
                  </td>
                  {weekDateStrs.map(date => {
                    const key = editKey(task.id, date);
                    return (
                      <td key={date} className="px-2 py-1">
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.1"
                          value={cellValue(task.id, date)}
                          onChange={e => setEditing(ed => ({ ...ed, [key]: e.target.value }))}
                          onBlur={() => handleBlur(task, date)}
                          disabled={saving === key}
                          placeholder="—"
                          className={`w-full text-center text-xs font-mono border rounded px-1 py-1 bg-background ${saving === key ? "opacity-50" : ""} ${(logMap.get(key) ?? 0) > 0 ? "border-accent/40 bg-accent/5" : "border-border"}`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right font-mono text-xs font-semibold">
                    {taskWeekTotal(task.id).toFixed(1)}d
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                <td className="px-4 py-2 text-xs font-medium">Daily Total</td>
                {dayTotals.map((t, i) => (
                  <td key={i} className="px-2 py-2 text-center font-mono text-xs">
                    {t > 0 ? t.toFixed(1) : "—"}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono text-xs">
                  {dayTotals.reduce((s, t) => s + t, 0).toFixed(1)}d
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Enter man-days (0.0–1.0) per cell. Changes save on blur.</p>
    </div>
  );
}
