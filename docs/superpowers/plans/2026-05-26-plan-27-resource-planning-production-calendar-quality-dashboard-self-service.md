# Plan #27 — Resource Planning, Production Calendar, Quality Dashboard, HR Self-Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM Resource Planning (team utilization heatmap), MFG Production Calendar (WO schedule by work center), Quality Dashboard (consolidated KPIs), HR Self-Service portal (payslips + leave).

**Architecture:**
- Resource Planning: client-side computation from `listAllTasks()` grouped by `assigneeId` × week
- Production Calendar: `listWorkOrders({ limit: 500 })` + `listWorkCenters()` — WO cards in a week grid
- Quality Dashboard: `listInspections()` + `listNCRs()` + `listApqp()` — all return plain arrays
- HR Self-Service: `listPayslips()` + `listLeaveRequests()` — standalone employee-facing page

**Tech Stack:** Next.js 15, React 19, Tailwind 4, `@pmplatform/ui-kit`

---

## Task 1: PM — Resource Planning

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Resource Planning to PM nav)
- Create: `apps/web/app/(shell)/pm/resources/page.tsx`

### Step 1.1 — Read API types

Read `apps/web/src/lib/api/tasks.ts`. Confirm:
- `Task` fields: `id`, `assigneeId` (camelCase, can be null), `estimateMd`, `startDate`, `dueDate`, `status`, `title`, `code`, `projectId`
- `listAllTasks()` return type: `{ items: Task[]; total: number }` — must unwrap `.items`
- `Task.estimateMd` is in man-days (float)

Read `apps/web/src/lib/api/identity.ts`. Confirm:
- `IdentityUser` fields: `id`, `name`, `email`
- `listIdentityUsers()` return type

### Step 1.2 — Add Resource Planning to PM nav

In `apps/web/src/lib/mock/apps.ts`, find PM hub. Add in the Plan/Track area, after Reports:

```typescript
{ id: "resources", name: "Resource Planning", href: "/pm/resources", icon: "people" },
```

### Step 1.3 — Create the Resource Planning page

Create `apps/web/app/(shell)/pm/resources/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listAllTasks, type Task } from "@/lib/api/tasks";
import { listIdentityUsers, type IdentityUser } from "@/lib/api/identity";

// Get Monday of week containing date d
function weekMonday(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function weekKey(d: Date): string {
  const m = weekMonday(d);
  return m.toISOString().slice(0, 10);
}

function addWeeks(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n * 7);
  return r;
}

// Distribute task estimateMd across the weeks it spans (startDate..dueDate)
function distributeTaskToWeeks(task: Task, weeks: Date[]): Map<string, number> {
  const result = new Map<string, number>();
  if (!task.estimateMd || task.estimateMd <= 0) return result;
  const start = task.startDate ? new Date(task.startDate) : new Date();
  const end = task.dueDate ? new Date(task.dueDate) : new Date(start.getTime() + 7 * 86400000);
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

const CAPACITY_MD_PER_WEEK = 5; // 5 man-days per week per person

export default function ResourcePlanningPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<IdentityUser[]>([]);
  const [loading, setLoading] = useState(true);

  // 8-week rolling window from current Monday
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

  // grid: Map<userId, Map<weekKey, totalMd>>
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
  }, [tasks, users, weeks]);

  const assignedUserIds = useMemo(() => {
    const ids = new Set(tasks.filter(t => t.assigneeId).map(t => t.assigneeId!));
    return [...ids];
  }, [tasks]);

  const userMap = useMemo(() => new Map(users.map(u => [u.id, u])), [users]);

  function cellColor(md: number): string {
    const pct = md / CAPACITY_MD_PER_WEEK;
    if (pct === 0) return "";
    if (pct > 1.0) return "bg-red-100 text-red-700 font-semibold";
    if (pct > 0.8) return "bg-amber-100 text-amber-700";
    return "bg-green-100 text-green-700";
  }

  const fmtMd = (md: number) => md === 0 ? "—" : md.toFixed(1) + "d";

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "PM" }, { label: "Resource Planning" }]} />

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-100 border border-green-200" /> &lt;80% capacity</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-100 border border-amber-200" /> 80–100%</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-100 border border-red-200" /> Over capacity</div>
        <span className="text-muted-foreground ml-2">Capacity = {CAPACITY_MD_PER_WEEK} man-days/week</span>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : assignedUserIds.length === 0 ? (
        <div className="text-sm text-muted-foreground">No assigned tasks found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground w-40">Team Member</th>
                {weeks.map(w => (
                  <th key={weekKey(w)} className="px-2 py-2 text-center font-medium text-xs text-muted-foreground min-w-[80px]">
                    <div>{w.toLocaleDateString("en", { month: "short", day: "numeric" })}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assignedUserIds.map(uid => {
                const user = userMap.get(uid);
                const userRow = grid.get(uid) ?? new Map();
                return (
                  <tr key={uid} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium text-xs whitespace-nowrap">
                      {user?.name ?? uid.slice(0, 8)}
                    </td>
                    {weeks.map(w => {
                      const md = userRow.get(weekKey(w)) ?? 0;
                      return (
                        <td key={weekKey(w)} className={`px-2 py-2 text-center text-xs font-mono rounded-sm ${cellColor(md)}`}>
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
```

---

## Task 2: MFG — Production Calendar

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Production Calendar to MFG nav)
- Create: `apps/web/app/(shell)/mfg/production-calendar/page.tsx`

### Step 2.1 — Read mfg.ts API types

Read `apps/web/src/lib/api/mfg.ts`. Confirm:
- `WorkOrder` fields: `id`, `code`, `workCenterId` (nullable), `startAt` (nullable), `endAt` (nullable), `dueDate` (nullable), `status`, `priority`, `qty`
- `WorkCenter` fields: `id`, `code`, `name`, `status`
- `listWorkOrders({ limit: 500 })` returns `{ items: WorkOrder[]; total: number }` — unwrap `.items`
- `listWorkCenters()` returns `WorkCenter[]` — set directly

### Step 2.2 — Add Production Calendar to MFG nav

In `apps/web/src/lib/mock/apps.ts`, find MFG production area. Add after Capacity Planning:

```typescript
{ id: "prod-calendar", name: "Production Calendar", href: "/mfg/production-calendar", icon: "workflow" },
```

### Step 2.3 — Create the Production Calendar page

Create `apps/web/app/(shell)/mfg/production-calendar/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listWorkOrders, listWorkCenters, type WorkOrder, type WorkCenter, type WOStatus } from "@/lib/api/mfg";

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

function getWOWeek(wo: WorkOrder): string | null {
  const d = wo.startAt ?? wo.dueDate;
  if (!d) return null;
  return weekKey(new Date(d));
}

const STATUS_COLORS: Record<WOStatus, string> = {
  planned: "bg-zinc-200 text-zinc-700",
  released: "bg-blue-200 text-blue-800",
  in_progress: "bg-amber-200 text-amber-800",
  completed: "bg-green-200 text-green-800",
  closed: "bg-zinc-300 text-zinc-600",
  cancelled: "bg-red-100 text-red-600 line-through",
};

export default function ProductionCalendarPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  // 4-week window starting at weekOffset from current Monday
  const weeks = useMemo(() => {
    const m = addWeeks(weekMonday(new Date()), weekOffset);
    return Array.from({ length: 4 }, (_, i) => addWeeks(m, i));
  }, [weekOffset]);

  useEffect(() => {
    Promise.all([
      listWorkOrders({ limit: 500 }).then(r => setWorkOrders(r.items)),
      listWorkCenters().then(setWorkCenters),
    ]).finally(() => setLoading(false));
  }, []);

  // grid: Map<wcId, Map<weekKey, WorkOrder[]>>
  const grid = useMemo(() => {
    const g = new Map<string, Map<string, WorkOrder[]>>();
    const weekKeys = new Set(weeks.map(w => weekKey(w)));
    for (const wc of workCenters) g.set(wc.id, new Map());
    for (const wo of workOrders) {
      const wk = getWOWeek(wo);
      if (!wk || !weekKeys.has(wk)) continue;
      const wcId = wo.workCenterId ?? "__unassigned__";
      if (!g.has(wcId)) g.set(wcId, new Map());
      const wcMap = g.get(wcId)!;
      if (!wcMap.has(wk)) wcMap.set(wk, []);
      wcMap.get(wk)!.push(wo);
    }
    return g;
  }, [workOrders, workCenters, weeks]);

  const wcWithData = useMemo(() => {
    const all = [...workCenters, { id: "__unassigned__", code: "—", name: "Unassigned", status: "active" as const, machineCount: 0, capacityPerDayHrs: 0, type: "machine" as const }];
    return all.filter(wc => (grid.get(wc.id)?.size ?? 0) > 0 || workCenters.some(w => w.id === wc.id));
  }, [workCenters, grid]);

  return (
    <div className="p-6 space-y-4">
      <Breadcrumb items={[{ label: "MFG" }, { label: "Production Calendar" }]} />

      {/* Week navigation */}
      <div className="flex items-center gap-3">
        <button onClick={() => setWeekOffset(o => o - 1)} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">← Prev</button>
        <span className="text-sm font-medium">
          {weeks[0].toLocaleDateString("en", { month: "short", day: "numeric" })} –{" "}
          {addWeeks(weeks[3], 1).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
        </span>
        <button onClick={() => setWeekOffset(o => o + 1)} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Next →</button>
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} className="px-3 py-1.5 text-xs rounded border border-border text-accent hover:bg-accent/10">Today</button>
        )}
      </div>

      {/* Color legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {(Object.entries(STATUS_COLORS) as [WOStatus, string][]).map(([s, cls]) => (
          <span key={s} className={`px-2 py-0.5 rounded text-xs ${cls}`}>{s.replace("_", " ")}</span>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-40">Work Center</th>
                {weeks.map(w => (
                  <th key={weekKey(w)} className="px-3 py-2 text-left text-xs font-medium text-muted-foreground min-w-[180px]">
                    {w.toLocaleDateString("en", { month: "short", day: "numeric" })}
                    {" – "}
                    {addWeeks(w, 1).toLocaleDateString("en", { month: "short", day: "numeric" })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wcWithData.map(wc => (
                <tr key={wc.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 font-medium text-xs whitespace-nowrap">{wc.name}</td>
                  {weeks.map(w => {
                    const wos = grid.get(wc.id)?.get(weekKey(w)) ?? [];
                    return (
                      <td key={weekKey(w)} className="px-2 py-2 align-top">
                        <div className="space-y-1 min-h-[40px]">
                          {wos.map(wo => (
                            <div key={wo.id} className={`px-2 py-1 rounded text-xs ${STATUS_COLORS[wo.status]}`}>
                              <div className="font-mono font-semibold">{wo.code}</div>
                              <div className="text-xs opacity-75">qty {wo.qty}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

---

## Task 3: Quality — Dashboard

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Dashboard to Quality nav if missing)
- Modify or create: `apps/web/app/(shell)/quality/home/page.tsx` (upgrade from stub to real dashboard)

### Step 3.1 — Read quality.ts API

Read `apps/web/src/lib/api/quality.ts`. Confirm:
- `Inspection` fields: `id`, `result` (`"pass" | "fail" | "hold"`), `inspectedAt`, `inspector`, `workOrderId`, `itemId`
- `NCR` fields: `id`, `status` (`"open" | "investigating" | "corrected" | "closed"`), `qty`, `severity`, `description`, `createdAt`
- `ApqpProject` fields: `id`, `name`, `status`, `phase`
- `listInspections({ limit: 100 })` returns `Inspection[]` — plain array, NO `.items`
- `listNCRs({ limit: 100 })` returns `NCR[]` — plain array, NO `.items`
- `listApqp()` returns `ApqpProject[]` — plain array, NO `.items`

### Step 3.2 — Check if quality app has its own nav

Read `apps/web/src/lib/mock/apps.ts`. Find the "quality" app definition (if it exists as a separate app, not just under MFG). Check if there's a standalone quality app with its own nav items.

If quality is a separate app in apps.ts, modify the home nav there. If quality items only appear under MFG (mfg/apqp, etc.), then also add a dedicated quality dashboard nav entry under MFG.

### Step 3.3 — Check the existing quality home page

Read `apps/web/app/(shell)/quality/home/page.tsx`. If it's a stub (just a placeholder with no real data), replace it with the real dashboard below.

Create/replace `apps/web/app/(shell)/quality/home/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listInspections, listNCRs, listApqp,
  type Inspection, type NCR, type ApqpProject,
  type InspectionResult, type NcrStatus,
} from "@/lib/api/quality";

export default function QualityDashboardPage() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [ncrs, setNcrs] = useState<NCR[]>([]);
  const [apqps, setApqps] = useState<ApqpProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listInspections({ limit: 100 }).then(setInspections),
      listNCRs({ limit: 100 }).then(setNcrs),
      listApqp().then(setApqps),
    ]).finally(() => setLoading(false));
  }, []);

  // Inspection stats
  const passCount = useMemo(() => inspections.filter(i => i.result === "pass").length, [inspections]);
  const failCount = useMemo(() => inspections.filter(i => i.result === "fail").length, [inspections]);
  const holdCount = useMemo(() => inspections.filter(i => i.result === "hold").length, [inspections]);
  const passRate = inspections.length === 0 ? null : Math.round(passCount / inspections.length * 100);

  // NCR stats
  const openNcrs = useMemo(() => ncrs.filter(n => n.status === "open").length, [ncrs]);
  const investigatingNcrs = useMemo(() => ncrs.filter(n => n.status === "investigating").length, [ncrs]);
  const highSeverityNcrs = useMemo(() => ncrs.filter(n => n.severity >= 3).length, [ncrs]);

  // NCR by status
  const ncrByStatus = useMemo(() => {
    const m: Record<NcrStatus, number> = { open: 0, investigating: 0, corrected: 0, closed: 0 };
    for (const n of ncrs) m[n.status]++;
    return m;
  }, [ncrs]);

  // APQP by status
  const apqpByStatus = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of apqps) m[a.status] = (m[a.status] ?? 0) + 1;
    return m;
  }, [apqps]);

  // Recent NCRs (last 5)
  const recentNcrs = useMemo(() =>
    [...ncrs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [ncrs]
  );

  const NCR_STATUS_COLORS: Record<NcrStatus, string> = {
    open: "bg-red-100 text-red-700",
    investigating: "bg-amber-100 text-amber-700",
    corrected: "bg-blue-100 text-blue-700",
    closed: "bg-green-100 text-green-700",
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Quality" }, { label: "Dashboard" }]} />

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Pass Rate</div>
          <div className={`text-2xl font-mono font-bold ${passRate != null && passRate < 90 ? "text-red-600" : "text-green-600"}`}>
            {passRate != null ? `${passRate}%` : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{inspections.length} inspections</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Open NCRs</div>
          <div className={`text-2xl font-mono font-bold ${openNcrs > 0 ? "text-red-600" : "text-green-600"}`}>
            {openNcrs}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{investigatingNcrs} under investigation</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">High Severity NCRs</div>
          <div className={`text-2xl font-mono font-bold ${highSeverityNcrs > 0 ? "text-amber-600" : "text-green-600"}`}>
            {highSeverityNcrs}
          </div>
          <div className="text-xs text-muted-foreground mt-1">severity ≥ 3</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Active APQP</div>
          <div className="text-2xl font-mono font-bold">
            {apqps.filter(a => a.status === "in_progress").length}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{apqps.length} total projects</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Inspection breakdown */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-medium mb-3">Inspection Results</h3>
          <div className="space-y-2">
            {([["pass", passCount, "bg-green-500"], ["fail", failCount, "bg-red-500"], ["hold", holdCount, "bg-amber-500"]] as const).map(([label, count, color]) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-10 capitalize">{label}</span>
                <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: inspections.length === 0 ? "0%" : `${count / inspections.length * 100}%` }}
                  />
                </div>
                <span className="text-xs font-mono w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* NCR by status */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-medium mb-3">NCR Status</h3>
          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(ncrByStatus) as [NcrStatus, number][]).map(([status, count]) => (
              <div key={status} className={`rounded px-3 py-2 ${NCR_STATUS_COLORS[status]}`}>
                <div className="text-lg font-mono font-bold">{count}</div>
                <div className="text-xs capitalize">{status.replace("_", " ")}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent NCRs */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 bg-muted/50 text-sm font-medium">Recent NCRs</div>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Description</th>
              <th className="px-4 py-2 text-left font-medium">Severity</th>
              <th className="px-4 py-2 text-left font-medium">Qty</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {recentNcrs.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No NCRs found</td></tr>
            )}
            {recentNcrs.map(ncr => (
              <tr key={ncr.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-4 py-3 text-xs">{ncr.description || "—"}</td>
                <td className="px-4 py-3">
                  <span className={`px-1.5 py-0.5 rounded text-xs ${ncr.severity >= 3 ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-600"}`}>
                    {ncr.severity}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{ncr.qty}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${NCR_STATUS_COLORS[ncr.status]}`}>
                    {ncr.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {new Date(ncr.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

## Task 4: HR — Self-Service Portal

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Self-Service to HR nav)
- Create: `apps/web/app/(shell)/hr/self-service/page.tsx`

### Step 4.1 — Read HR types

Read `apps/web/src/lib/api/hr.ts`. Confirm:
- `Payslip` fields: `id`, `employeeId`, `periodStart`, `periodEnd`, `grossPay`, `deductions`, `netPay`, `status`
- `LeaveRequest` fields: `id`, `employeeId`, `leave_type`, `startDate`, `endDate`, `status`, `days`, `notes`
- `listPayslips(params?)` returns `{ items: Payslip[]; total: number }` — unwrap `.items`
- `listLeaveRequests(params?)` returns `{ items: LeaveRequest[]; total: number }` — unwrap `.items`
- `createLeaveRequest(input)` signature

### Step 4.2 — Add Self-Service to HR nav

In `apps/web/src/lib/mock/apps.ts`, find HR hub. Add in the People area before Departments:

```typescript
{ id: "self-service", name: "Self Service", href: "/hr/self-service", icon: "people" },
```

### Step 4.3 — Create Self-Service page

Create `apps/web/app/(shell)/hr/self-service/page.tsx`:

```typescript
"use client";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listPayslips, listLeaveRequests, createLeaveRequest,
  type Payslip, type LeaveRequest,
} from "@/lib/api/hr";

const LEAVE_TYPES = ["annual", "sick", "personal", "maternity", "paternity", "unpaid"] as const;
type LeaveType = typeof LEAVE_TYPES[number];

const LEAVE_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-zinc-100 text-zinc-500",
};

const PAYSLIP_STATUS_COLORS: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
};

export default function SelfServicePage() {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [tab, setTab] = useState<"payslips" | "leave">("payslips");
  const [loading, setLoading] = useState(true);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [leaveType, setLeaveType] = useState<LeaveType>("annual");
  const [leaveStart, setLeaveStart] = useState("");
  const [leaveEnd, setLeaveEnd] = useState("");
  const [leaveNotes, setLeaveNotes] = useState("");

  useEffect(() => {
    Promise.all([
      listPayslips().then(r => setPayslips(r.items)),
      listLeaveRequests().then(r => setLeaveRequests(r.items)),
    ]).finally(() => setLoading(false));
  }, []);

  async function handleSubmitLeave() {
    if (!leaveStart || !leaveEnd) return;
    const req = await createLeaveRequest({
      leave_type: leaveType,
      start_date: leaveStart,
      end_date: leaveEnd,
      notes: leaveNotes,
    });
    setLeaveRequests(prev => [req, ...prev]);
    setShowLeaveForm(false);
    setLeaveStart(""); setLeaveEnd(""); setLeaveNotes("");
  }

  const totalAnnualUsed = leaveRequests.filter(l => l.leave_type === "annual" && l.status === "approved").reduce((s, l) => s + l.days, 0);
  const totalSickUsed = leaveRequests.filter(l => l.leave_type === "sick" && l.status === "approved").reduce((s, l) => s + l.days, 0);

  const fmt = (n: number) => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Self Service" }]} />

      {/* Leave balance summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Annual Leave Used</div>
          <div className="text-2xl font-mono font-bold">{totalAnnualUsed} <span className="text-sm font-normal text-muted-foreground">days</span></div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Sick Leave Used</div>
          <div className="text-2xl font-mono font-bold">{totalSickUsed} <span className="text-sm font-normal text-muted-foreground">days</span></div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Pending Requests</div>
          <div className="text-2xl font-mono font-bold">{leaveRequests.filter(l => l.status === "pending").length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["payslips", "leave"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t === "payslips" ? "My Payslips" : "Leave Requests"}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : tab === "payslips" ? (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Gross Pay</th>
                <th className="px-4 py-2 text-right font-medium">Deductions</th>
                <th className="px-4 py-2 text-right font-medium">Net Pay</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {payslips.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No payslips found</td></tr>
              )}
              {payslips.map(p => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">
                    {p.periodStart?.slice(0, 7)} – {p.periodEnd?.slice(0, 7)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(p.grossPay)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-red-600">-{fmt(p.deductions)}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold">{fmt(p.netPay)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${PAYSLIP_STATUS_COLORS[p.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowLeaveForm(true)} className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/90">
              + Request Leave
            </button>
          </div>

          {showLeaveForm && (
            <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
              <h3 className="text-sm font-medium">New Leave Request</h3>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Leave Type</label>
                  <select value={leaveType} onChange={e => setLeaveType(e.target.value as LeaveType)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                    {LEAVE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Start Date</label>
                  <input type="date" value={leaveStart} onChange={e => setLeaveStart(e.target.value)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">End Date</label>
                  <input type="date" value={leaveEnd} onChange={e => setLeaveEnd(e.target.value)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Notes (optional)</label>
                <input value={leaveNotes} onChange={e => setLeaveNotes(e.target.value)}
                  className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" placeholder="Reason for leave…" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSubmitLeave} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90">Submit</button>
                <button onClick={() => setShowLeaveForm(false)} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Cancel</button>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Type</th>
                  <th className="px-4 py-2 text-left font-medium">Start</th>
                  <th className="px-4 py-2 text-left font-medium">End</th>
                  <th className="px-4 py-2 text-right font-medium">Days</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {leaveRequests.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No leave requests</td></tr>
                )}
                {leaveRequests.map(lr => (
                  <tr key={lr.id} className="border-t border-border hover:bg-muted/20">
                    <td className="px-4 py-3 capitalize text-xs">{lr.leave_type}</td>
                    <td className="px-4 py-3 font-mono text-xs">{lr.startDate?.slice(0, 10)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{lr.endDate?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{lr.days}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${LEAVE_STATUS_COLORS[lr.status] ?? "bg-zinc-100 text-zinc-600"}`}>
                        {lr.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

IMPORTANT for Step 4.3: Check the actual field names in `Payslip` and `LeaveRequest` from hr.ts before writing. The plan uses `p.periodStart`, `p.periodEnd`, `p.grossPay`, `p.deductions`, `p.netPay` — verify these match the actual interface. For LeaveRequest, check if it uses `startDate`/`endDate` or `start_date`/`end_date` for the interface fields (normalizer converts from snake to camel but the interface itself may be camelCase).
