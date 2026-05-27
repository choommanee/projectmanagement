"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listAllTasks, type Task } from "@/lib/api/tasks";
import { listIdentityUsers, type IdentityUser } from "@/lib/api/identity";

function weekMonday(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function addWeeks(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n * 7);
  return r;
}

function weekKey(d: Date): string {
  return weekMonday(d).toISOString().slice(0, 10);
}

function distributeTaskToWeeks(task: Task, weeks: Date[]): Map<string, number> {
  const result = new Map<string, number>();
  if (!task.estimateMd || task.estimateMd <= 0) return result;
  const start = task.startDate ? new Date(task.startDate) : new Date();
  const end = task.dueDate ? new Date(task.dueDate) : addWeeks(start, 1);
  const taskDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
  const mdPerDay = task.estimateMd / taskDays;
  for (const weekStart of weeks) {
    const weekEnd = addWeeks(weekStart, 1);
    const overlapStart = new Date(Math.max(start.getTime(), weekStart.getTime()));
    const overlapEnd = new Date(Math.min(end.getTime(), weekEnd.getTime()));
    if (overlapEnd > overlapStart) {
      const overlapDays = (overlapEnd.getTime() - overlapStart.getTime()) / 86400000;
      const md = mdPerDay * overlapDays;
      if (md > 0.01) result.set(weekKey(weekStart), md);
    }
  }
  return result;
}

const CAPACITY_MD_PER_WEEK = 5;

export default function ResourcePlanningPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<IdentityUser[]>([]);
  const [loading, setLoading] = useState(true);

  const weeks = useMemo(() => {
    const m = weekMonday(new Date());
    return Array.from({ length: 8 }, (_, i) => addWeeks(m, i));
  }, []);

  useEffect(() => {
    Promise.all([
      listAllTasks({ limit: 500 }).then(r => setTasks(r.items)),
      listIdentityUsers().then(setUsers),
    ]).finally(() => setLoading(false));
  }, []);

  const grid = useMemo(() => {
    const g = new Map<string, Map<string, number>>();
    for (const task of tasks) {
      if (!task.assigneeId) continue;
      if (task.status === "done" || task.status === "cancelled") continue;
      if (!g.has(task.assigneeId)) g.set(task.assigneeId, new Map());
      const userMap = g.get(task.assigneeId)!;
      const dist = distributeTaskToWeeks(task, weeks);
      for (const [wk, md] of dist) {
        userMap.set(wk, (userMap.get(wk) ?? 0) + md);
      }
    }
    return g;
  }, [tasks, weeks]);

  const assignedUserIds = useMemo(() => {
    const ids = new Set(tasks.filter(t => t.assigneeId).map(t => t.assigneeId!));
    return [...ids];
  }, [tasks]);

  const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  function cellColor(md: number): string {
    if (md === 0) return "";
    const pct = md / CAPACITY_MD_PER_WEEK;
    if (pct > 1.0) return "bg-danger/10 text-danger font-semibold";
    if (pct > 0.8) return "bg-warning/10 text-warning";
    return "bg-success/10 text-success";
  }

  const fmtMd = (md: number) => md === 0 ? "—" : md.toFixed(1) + "d";

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "PM" }, { label: "Resource Planning" }]} />

      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-success/10 border border-success/20 inline-block" /> &lt;80% capacity</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-warning/10 border border-warning/20 inline-block" /> 80–100%</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-danger/10 border border-danger/20 inline-block" /> Over capacity</div>
        <span className="text-ink-3 ml-2">Capacity = {CAPACITY_MD_PER_WEEK} man-days/week</span>
      </div>

      {loading ? (
        <div className="text-sm text-ink-3">Loading...</div>
      ) : assignedUserIds.length === 0 ? (
        <div className="text-sm text-ink-3 py-8 text-center">No assigned tasks found in the next 8 weeks.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface-2/50">
                <th className="px-4 py-2 text-left font-medium text-xs text-ink-3 w-44 border-b border-line">Team Member</th>
                {weeks.map(w => (
                  <th key={weekKey(w)} className="px-2 py-2 text-center font-medium text-xs text-ink-3 min-w-[80px] border-b border-line">
                    {w.toLocaleDateString("en", { month: "short", day: "numeric" })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assignedUserIds.map(uid => {
                const user = userMap.get(uid);
                const userRow = grid.get(uid) ?? new Map();
                return (
                  <tr key={uid} className="border-t border-line hover:bg-surface-2/20">
                    <td className="px-4 py-2 font-medium text-xs whitespace-nowrap">
                      {user?.display_name ?? user?.email ?? uid.slice(0, 8)}
                    </td>
                    {weeks.map(w => {
                      const md = userRow.get(weekKey(w)) ?? 0;
                      return (
                        <td key={weekKey(w)} className={`px-2 py-2 text-center text-xs font-mono ${cellColor(md)}`}>
                          {fmtMd(md)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
