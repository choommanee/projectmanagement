# Plan #28 — Timesheet, Customer 360, HR Recruitment, Admin System Health

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PM Weekly Timesheet (log hours per task per day), Sales Customer 360 (full customer profile with order/quote/invoice history), HR Recruitment (job openings + applicant pipeline), Admin System Health (service activity dashboard from audit events).

**Architecture:**
- Timesheet: weekly grid using existing `worklog.ts` (`listWorklogs(taskId)` + `createWorklog()`), tasks from `listAllTasks()`
- Customer 360: new `/sales/customers/[id]` dynamic page using `getCustomer()` + client-side filtered lists
- Recruitment: new `JobPosting` + `Applicant` types in hr.ts + proxy to hr-svc `/v1/jobs`
- System Health: uses `listAudit()` + `getBuckets()` from audit.ts — no new backend

**Tech Stack:** Next.js 15, React 19, Tailwind 4, `@pmplatform/ui-kit`

---

## Task 1: PM — Weekly Timesheet

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Timesheet to PM nav)
- Create: `apps/web/app/(shell)/pm/timesheet/page.tsx`

### Step 1.1 — Read worklog and tasks APIs

Read `apps/web/src/lib/api/worklog.ts`:
- `WorklogEntry` fields: `id`, `taskId`, `userId`, `loggedMd` (man-days, float), `workDate` ("YYYY-MM-DD"), `note`
- `listWorklogs(taskId)` returns `WorklogEntry[]` — plain array
- `createWorklog(taskId, { userId, loggedMd, workDate, note })` returns `WorklogEntry`

Read `apps/web/src/lib/api/tasks.ts`:
- `Task` fields: `id`, `code`, `title`, `assigneeId`, `projectId`, `status`, `estimateMd`, `actualMd`
- `listAllTasks({ limit, assignee? })` returns `{ items: Task[]; total: number }` — unwrap `.items`

### Step 1.2 — Add Timesheet to PM nav

In `apps/web/src/lib/mock/apps.ts`, find PM hub. Add after My Tasks:
```typescript
{ id: "timesheet", name: "Timesheet", href: "/pm/timesheet", icon: "tasks" },
```

### Step 1.3 — Create the Timesheet page

Create `apps/web/app/(shell)/pm/timesheet/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listAllTasks, type Task } from "@/lib/api/tasks";
import { listWorklogs, createWorklog, type WorklogEntry } from "@/lib/api/worklog";

// Week helpers
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
  // editing: { taskId, date } → current input value
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null); // "taskId|date"

  const monday = useMemo(() => addDays(weekMonday(new Date()), weekOffset * 7), [weekOffset]);
  const weekDates = useMemo(() => Array.from({ length: 5 }, (_, i) => addDays(monday, i)), [monday]);
  const weekDateStrs = useMemo(() => weekDates.map(toDateStr), [weekDates]);

  // Load tasks assigned to current user (all active tasks)
  useEffect(() => {
    listAllTasks({ limit: 200 }).then(r => {
      const active = r.items.filter(t => t.status !== "done" && t.status !== "cancelled");
      setTasks(active);
      // Load worklogs for each task
      return Promise.all(active.map(t => listWorklogs(t.id).catch(() => [])));
    }).then(allLogs => {
      setLogs(allLogs.flat());
    }).finally(() => setLoading(false));
  }, []);

  // Map: taskId+date → loggedMd
  const logMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const log of logs) {
      m.set(`${log.taskId}|${log.workDate}`, log.loggedMd);
    }
    return m;
  }, [logs]);

  // Totals per day
  const dayTotals = useMemo(() =>
    weekDateStrs.map(d =>
      [...logMap.entries()]
        .filter(([k]) => k.endsWith(`|${d}`))
        .reduce((s, [, v]) => s + v, 0)
    ),
    [logMap, weekDateStrs]
  );

  // Totals per task for this week
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
        userId: "", // server extracts from JWT
        loggedMd: md,
        workDate: date,
        note: "",
      });
      setLogs(prev => {
        const filtered = prev.filter(l => !(l.taskId === task.id && l.workDate === date));
        return [...filtered, entry];
      });
    } catch {
      // noop — keep local value
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

      {/* Week navigation */}
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
              {/* Day totals row */}
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
```

---

## Task 2: Sales — Customer 360

**Files:**
- Create: `apps/web/app/(shell)/sales/customers/[id]/page.tsx`

No nav changes needed — the Customers list page at `/sales/customers` already exists. Clicking a customer row should navigate to `/sales/customers/[id]`.

### Step 2.1 — Read sales.ts

Read `apps/web/src/lib/api/sales.ts`. Confirm:
- `Customer` fields: `id`, `code`, `name`, `contact`, `email`, `phone`, `billingAddress`, `active`
- `getCustomer(id)` returns `Customer`
- `listSalesOrders(params)` returns `{ items: SalesOrder[]; total: number }` — filter client-side by `so.customerId === id`
- `listQuotes(params?: { customer_id?: string })` returns `Quote[]` — has customer_id filter ✓
- `listSalesInvoices(params?)` returns `SalesInvoice[]` — filter client-side by `inv.customerId === id`
- `listShipments(params)` returns `{ items: Shipment[]; total: number }` — may need client-side filter
- `SalesOrder` fields: `id`, `soNumber`, `customerId`, `status`, `orderDate`, `lines`
- `Quote` fields: `id`, `code`, `customerId`, `customerName`, `status`, `validUntil`, `totalAmount`
- `SalesInvoice` fields: `id`, `invoiceNumber`, `customerId`, `status`, `issuedDate`, `dueDate`, `totalAmount`

### Step 2.2 — Check existing customers page

Read `apps/web/app/(shell)/sales/customers/page.tsx`. Check if it has a row click handler. If not, note that — the Customer 360 page will still work when navigated to directly.

### Step 2.3 — Update customers list page to link to detail

In the customers list page, if rows are not already clickable, add `onClick={() => router.push('/sales/customers/' + c.id)}` to each table row and import `useRouter` from `"next/navigation"`.

### Step 2.4 — Create Customer 360 page

Create `apps/web/app/(shell)/sales/customers/[id]/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getCustomer, listSalesOrders, listQuotes, listSalesInvoices, listShipments,
  type Customer, type SalesOrder, type Quote, type SalesInvoice, type Shipment,
  type SOStatus, type QuoteStatus, type InvoiceStatus,
} from "@/lib/api/sales";

const SO_COLORS: Record<SOStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  confirmed: "bg-blue-100 text-blue-700",
  shipped: "bg-amber-100 text-amber-700",
  invoiced: "bg-indigo-100 text-indigo-700",
  cancelled: "bg-red-100 text-red-600",
};

const QUOTE_COLORS: Record<QuoteStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  sent: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-600",
  expired: "bg-zinc-200 text-zinc-500",
};

const INV_COLORS: Record<InvoiceStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-zinc-200 text-zinc-500",
};

type Tab = "orders" | "quotes" | "invoices" | "shipments";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [tab, setTab] = useState<Tab>("orders");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getCustomer(id).then(setCustomer),
      listSalesOrders({ limit: 100 }).then(r => setOrders(r.items.filter(o => o.customerId === id))),
      listQuotes({ customer_id: id }).then(setQuotes),
      listSalesInvoices().then(invs => {
        const arr = Array.isArray(invs) ? invs : (invs as { items?: SalesInvoice[] }).items ?? [];
        setInvoices(arr.filter(inv => inv.customerId === id));
      }),
      listShipments({ limit: 100 }).then(r => setShipments(r.items)),
    ]).finally(() => setLoading(false));
  }, [id]);

  const totalRevenue = useMemo(() =>
    invoices.filter(i => i.status === "paid").reduce((s, i) => s + i.totalAmount, 0), [invoices]);

  const openOrders = orders.filter(o => o.status !== "cancelled" && o.status !== "invoiced").length;
  const pendingInvoiceAmt = invoices.filter(i => i.status === "sent" || i.status === "overdue").reduce((s, i) => s + i.totalAmount, 0);

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!customer) return <div className="p-6 text-sm text-red-600">Customer not found</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Sales" }, { label: "Customers", href: "/sales/customers" }, { label: customer.name }]} />

      {/* Customer header */}
      <div className="rounded-lg border border-border bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-muted-foreground">{customer.code}</span>
            {!customer.active && <span className="px-1.5 py-0.5 rounded text-xs bg-zinc-100 text-zinc-500">Inactive</span>}
          </div>
          <h1 className="text-xl font-semibold">{customer.name}</h1>
          <div className="mt-2 space-y-0.5 text-sm text-muted-foreground">
            {customer.contact && <div>{customer.contact}</div>}
            {customer.email && <div>{customer.email}</div>}
            {customer.phone && <div>{customer.phone}</div>}
            {customer.billingAddress && <div className="text-xs">{customer.billingAddress}</div>}
          </div>
        </div>
        <button onClick={() => router.back()} className="text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded">← Back</button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Revenue</div>
          <div className="text-xl font-mono font-bold text-green-600">{fmt(totalRevenue)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Open Orders</div>
          <div className="text-xl font-mono font-bold">{openOrders}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Outstanding AR</div>
          <div className={`text-xl font-mono font-bold ${pendingInvoiceAmt > 0 ? "text-amber-600" : ""}`}>{fmt(pendingInvoiceAmt)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Quotes</div>
          <div className="text-xl font-mono font-bold">{quotes.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["orders", "quotes", "invoices", "shipments"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}{" "}
            <span className="text-xs">({t === "orders" ? orders.length : t === "quotes" ? quotes.length : t === "invoices" ? invoices.length : shipments.length})</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "orders" && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">SO #</th>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Lines</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No orders</td></tr>}
              {orders.map(o => (
                <tr key={o.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">{o.soNumber}</td>
                  <td className="px-4 py-3 text-xs">{o.orderDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${SO_COLORS[o.status]}`}>{o.status}</span></td>
                  <td className="px-4 py-3 text-right text-xs">{o.lines.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "quotes" && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Quote #</th>
                <th className="px-4 py-2 text-left font-medium">Valid Until</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No quotes</td></tr>}
              {quotes.map(q => (
                <tr key={q.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">{q.code}</td>
                  <td className="px-4 py-3 text-xs">{q.validUntil?.slice(0, 10) ?? "—"}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${QUOTE_COLORS[q.status]}`}>{q.status}</span></td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(q.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "invoices" && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Invoice #</th>
                <th className="px-4 py-2 text-left font-medium">Issued</th>
                <th className="px-4 py-2 text-left font-medium">Due</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No invoices</td></tr>}
              {invoices.map(inv => (
                <tr key={inv.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 text-xs">{inv.issuedDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs">{inv.dueDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${INV_COLORS[inv.status]}`}>{inv.status}</span></td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(inv.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "shipments" && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Shipment #</th>
                <th className="px-4 py-2 text-left font-medium">SO #</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {shipments.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No shipments</td></tr>}
              {shipments.map(s => (
                <tr key={s.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono text-xs">{s.shipmentNumber}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.soId}</td>
                  <td className="px-4 py-3 text-xs capitalize">{s.status}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{s.createdAt?.slice(0, 10)}</td>
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

IMPORTANT: Before writing this file, read `apps/web/src/lib/api/sales.ts` to verify:
- `SalesInvoice` fields: confirm exact names `invoiceNumber`, `issuedDate`, `dueDate`, `totalAmount`, `customerId` — verify these camelCase names exist in the interface
- `Quote` fields: confirm `code`, `validUntil`, `totalAmount`, `customerId` exist
- `Shipment` fields: confirm `shipmentNumber`, `soId`, `status`, `createdAt`
- `listSalesInvoices()` return type: `SalesInvoice[]` or `{ items: SalesInvoice[] }` — adjust accordingly

---

## Task 3: HR — Recruitment

**Files:**
- Modify: `apps/web/src/lib/api/hr.ts` (add `JobPosting` + `Applicant` types)
- Modify: `apps/web/src/lib/mock/apps.ts` (add Recruitment to HR nav)
- Create: `apps/web/app/api/hr/jobs/route.ts` (GET, POST)
- Create: `apps/web/app/api/hr/jobs/[id]/route.ts` (GET, PATCH)
- Create: `apps/web/app/api/hr/jobs/[id]/applicants/route.ts` (GET, POST)
- Create: `apps/web/app/(shell)/hr/recruitment/page.tsx`

### Step 3.1 — Read hr.ts to understand patterns

Read `apps/web/src/lib/api/hr.ts`. Note the `g()`, `gid()` helpers, `const SVC`, `apiFetch()`.

### Step 3.2 — Add Recruitment types to hr.ts

Append to `apps/web/src/lib/api/hr.ts`:

```typescript
// ─── Recruitment ────────────────────────────────────────────────────────────

export type JobStatus = "open" | "closed" | "draft" | "on_hold";
export type ApplicantStage = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";

export interface JobPosting {
  id: string;
  title: string;
  departmentId: string | null;
  departmentName: string;
  positionId: string | null;
  positionName: string;
  status: JobStatus;
  openings: number;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Applicant {
  id: string;
  jobId: string;
  name: string;
  email: string;
  phone: string;
  stage: ApplicantStage;
  notes: string;
  appliedAt: string;
  updatedAt: string;
}

function normJobPosting(r: Record<string, unknown>): JobPosting {
  return {
    id: String(r.id ?? ""),
    title: String(g(r, "title") ?? ""),
    departmentId: (gid(r, "departmentId", "department_id") as string | null) ?? null,
    departmentName: String(gid(r, "departmentName", "department_name") ?? ""),
    positionId: (gid(r, "positionId", "position_id") as string | null) ?? null,
    positionName: String(gid(r, "positionName", "position_name") ?? ""),
    status: (g(r, "status") ?? "draft") as JobStatus,
    openings: Number(g(r, "openings") ?? 1),
    description: String(g(r, "description") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

function normApplicant(r: Record<string, unknown>): Applicant {
  return {
    id: String(r.id ?? ""),
    jobId: String(gid(r, "jobId", "job_id") ?? ""),
    name: String(g(r, "name") ?? ""),
    email: String(g(r, "email") ?? ""),
    phone: String(g(r, "phone") ?? ""),
    stage: (g(r, "stage") ?? "applied") as ApplicantStage,
    notes: String(g(r, "notes") ?? ""),
    appliedAt: String(gid(r, "appliedAt", "applied_at") ?? gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

export async function listJobPostings(params?: { status?: JobStatus }): Promise<{ items: JobPosting[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  const r = await apiFetch(`${SVC}/jobs?${sp}`);
  if (!r.ok) throw new Error(`listJobPostings: ${r.status}`);
  const data = await r.json();
  if (Array.isArray(data)) return { items: (data as Record<string, unknown>[]).map(normJobPosting), total: data.length };
  const obj = data as Record<string, unknown>;
  return { items: Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normJobPosting) : [], total: Number(obj.total ?? 0) };
}

export async function createJobPosting(input: {
  title: string;
  department_id?: string;
  position_id?: string;
  openings?: number;
  description?: string;
}): Promise<JobPosting> {
  const r = await apiFetch(`${SVC}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createJobPosting: ${r.status}`);
  return normJobPosting(await r.json());
}

export async function updateJobPosting(id: string, patch: Partial<{ status: JobStatus; openings: number; description: string }>): Promise<JobPosting> {
  const r = await apiFetch(`${SVC}/jobs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateJobPosting: ${r.status}`);
  return normJobPosting(await r.json());
}

export async function listApplicants(jobId: string): Promise<Applicant[]> {
  const r = await apiFetch(`${SVC}/jobs/${jobId}/applicants`);
  if (!r.ok) throw new Error(`listApplicants: ${r.status}`);
  const data = await r.json();
  if (Array.isArray(data)) return (data as Record<string, unknown>[]).map(normApplicant);
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normApplicant) : [];
}

export async function createApplicant(jobId: string, input: { name: string; email: string; phone?: string; notes?: string }): Promise<Applicant> {
  const r = await apiFetch(`${SVC}/jobs/${jobId}/applicants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createApplicant: ${r.status}`);
  return normApplicant(await r.json());
}

export async function updateApplicantStage(jobId: string, applicantId: string, stage: ApplicantStage): Promise<Applicant> {
  const r = await apiFetch(`${SVC}/jobs/${jobId}/applicants/${applicantId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage }),
  });
  if (!r.ok) throw new Error(`updateApplicantStage: ${r.status}`);
  return normApplicant(await r.json());
}
```

### Step 3.3 — Create proxy routes

Read an existing HR proxy route (e.g., `apps/web/app/api/hr/performance-reviews/route.ts`) for the exact pattern.

Create `apps/web/app/api/hr/jobs/route.ts` — GET + POST to `http://localhost:8096/v1/jobs`
Create `apps/web/app/api/hr/jobs/[id]/route.ts` — GET + PATCH to `http://localhost:8096/v1/jobs/:id`
Create `apps/web/app/api/hr/jobs/[id]/applicants/route.ts` — GET + POST to `http://localhost:8096/v1/jobs/:id/applicants`

All use negative guard makeHeaders. `[id]` routes use `{ params: Promise<{ id: string }> }` + `await params`.

### Step 3.4 — Add Recruitment nav

In `apps/web/src/lib/mock/apps.ts`, find HR People area. Add after Self Service:
```typescript
{ id: "recruitment", name: "Recruitment", href: "/hr/recruitment", icon: "people" },
```

### Step 3.5 — Create Recruitment page

Create `apps/web/app/(shell)/hr/recruitment/page.tsx`:

The page has two views:
1. **Job Postings list** — table of open/draft/closed jobs with status badges. "+ New Job" form (title, openings count). Click a row to see applicants.
2. **Applicant pipeline** — when a job is selected, show a Kanban-style pipeline (applied → screening → interview → offer → hired / rejected). Each card: applicant name, email. Advance button → next stage. Add applicant form.

```typescript
"use client";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listJobPostings, createJobPosting, updateJobPosting,
  listApplicants, createApplicant, updateApplicantStage,
  type JobPosting, type Applicant, type JobStatus, type ApplicantStage,
} from "@/lib/api/hr";

const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  open: "bg-green-100 text-green-700",
  on_hold: "bg-amber-100 text-amber-700",
  closed: "bg-zinc-200 text-zinc-500",
};

const STAGES: ApplicantStage[] = ["applied", "screening", "interview", "offer", "hired", "rejected"];

const STAGE_COLORS: Record<ApplicantStage, string> = {
  applied: "bg-zinc-200",
  screening: "bg-blue-200",
  interview: "bg-indigo-200",
  offer: "bg-amber-200",
  hired: "bg-green-200",
  rejected: "bg-red-100",
};

export default function RecruitmentPage() {
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [selected, setSelected] = useState<JobPosting | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewJob, setShowNewJob] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newOpenings, setNewOpenings] = useState("1");
  const [showNewApplicant, setShowNewApplicant] = useState(false);
  const [appName, setAppName] = useState("");
  const [appEmail, setAppEmail] = useState("");

  useEffect(() => {
    listJobPostings().then(r => setJobs(r.items)).finally(() => setLoading(false));
  }, []);

  async function selectJob(job: JobPosting) {
    setSelected(job);
    const apps = await listApplicants(job.id);
    setApplicants(apps);
  }

  async function handleCreateJob() {
    if (!newTitle) return;
    const job = await createJobPosting({ title: newTitle, openings: parseInt(newOpenings) || 1 });
    setJobs(prev => [job, ...prev]);
    setShowNewJob(false);
    setNewTitle(""); setNewOpenings("1");
  }

  async function handleAddApplicant() {
    if (!selected || !appName || !appEmail) return;
    const app = await createApplicant(selected.id, { name: appName, email: appEmail });
    setApplicants(prev => [app, ...prev]);
    setShowNewApplicant(false);
    setAppName(""); setAppEmail("");
  }

  async function advanceStage(app: Applicant) {
    if (!selected) return;
    const nextIdx = STAGES.indexOf(app.stage) + 1;
    if (nextIdx >= STAGES.length) return;
    const updated = await updateApplicantStage(selected.id, app.id, STAGES[nextIdx]);
    setApplicants(prev => prev.map(a => a.id === updated.id ? updated : a));
  }

  async function toggleJobStatus(job: JobPosting) {
    const newStatus: JobStatus = job.status === "open" ? "closed" : "open";
    const updated = await updateJobPosting(job.id, { status: newStatus });
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
    if (selected?.id === updated.id) setSelected(updated);
  }

  const stageGroups = STAGES.reduce((acc, stage) => {
    acc[stage] = applicants.filter(a => a.stage === stage);
    return acc;
  }, {} as Record<ApplicantStage, Applicant[]>);

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Recruitment" }]} />

      <div className="grid grid-cols-2 gap-6">
        {/* Job Postings list */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Job Postings</h2>
            <button onClick={() => setShowNewJob(true)} className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90">+ New Job</button>
          </div>

          {showNewJob && (
            <div className="rounded border border-border bg-surface p-3 space-y-2">
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Job title"
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              <input type="number" value={newOpenings} onChange={e => setNewOpenings(e.target.value)} placeholder="Openings"
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" min="1" />
              <div className="flex gap-2">
                <button onClick={handleCreateJob} className="px-2 py-1 text-xs rounded bg-accent text-white">Create</button>
                <button onClick={() => setShowNewJob(false)} className="px-2 py-1 text-xs rounded border border-border">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {jobs.map(job => (
              <div key={job.id}
                onClick={() => selectJob(job)}
                className={`rounded-lg border p-3 cursor-pointer transition-colors ${selected?.id === job.id ? "border-accent bg-accent/5" : "border-border hover:bg-muted/30"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{job.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{job.departmentName || "—"} · {job.openings} opening{job.openings !== 1 ? "s" : ""}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${JOB_STATUS_COLORS[job.status]}`}>{job.status}</span>
                    <button onClick={e => { e.stopPropagation(); toggleJobStatus(job); }}
                      className="text-xs text-muted-foreground hover:text-foreground">
                      {job.status === "open" ? "Close" : "Open"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Applicant pipeline */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{selected ? `Applicants — ${selected.title}` : "Select a job"}</h2>
            {selected && (
              <button onClick={() => setShowNewApplicant(true)} className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90">+ Add Applicant</button>
            )}
          </div>

          {selected && showNewApplicant && (
            <div className="rounded border border-border bg-surface p-3 space-y-2">
              <input value={appName} onChange={e => setAppName(e.target.value)} placeholder="Full name"
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              <input value={appEmail} onChange={e => setAppEmail(e.target.value)} placeholder="Email"
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
              <div className="flex gap-2">
                <button onClick={handleAddApplicant} className="px-2 py-1 text-xs rounded bg-accent text-white">Add</button>
                <button onClick={() => setShowNewApplicant(false)} className="px-2 py-1 text-xs rounded border border-border">Cancel</button>
              </div>
            </div>
          )}

          {selected ? (
            <div className="space-y-2">
              {STAGES.filter(s => s !== "rejected").map(stage => {
                const stageApps = stageGroups[stage] ?? [];
                return (
                  <div key={stage}>
                    <div className={`rounded-t px-3 py-1.5 text-xs font-semibold ${STAGE_COLORS[stage]}`}>
                      {stage.charAt(0).toUpperCase() + stage.slice(1)} ({stageApps.length})
                    </div>
                    <div className="rounded-b border border-t-0 border-border bg-surface p-2 space-y-1 min-h-[48px]">
                      {stageApps.map(app => (
                        <div key={app.id} className="flex items-center justify-between rounded border border-border px-2 py-1.5 bg-paper">
                          <div>
                            <div className="text-xs font-medium">{app.name}</div>
                            <div className="text-xs text-muted-foreground">{app.email}</div>
                          </div>
                          {stage !== "hired" && (
                            <button onClick={() => advanceStage(app)}
                              className="px-1.5 py-0.5 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20">
                              →
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground py-8 text-center">Click a job posting to view applicants</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

## Task 4: Admin — System Health Dashboard

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add System Health to Admin nav)
- Create: `apps/web/app/(shell)/admin/system-health/page.tsx`

### Step 4.1 — Read audit.ts

Read `apps/web/src/lib/api/audit.ts`. Confirm:
- `AuditEvent` fields: `id`, `ts`, `service`, `action`, `entityType`, `userId`, `result`, `ip`
- `Bucket` fields: `day`, `service`, `count`
- `listAudit(opts)` returns `{ items: AuditEvent[]; total: number }` — unwrap `.items`
- `getBuckets(days?)` returns `Bucket[]` — plain array

### Step 4.2 — Add System Health to Admin nav

In `apps/web/src/lib/mock/apps.ts`, find Admin hub. Add in Audit & Compliance area after Audit Log:
```typescript
{ id: "system-health", name: "System Health", href: "/admin/system-health", icon: "dashboard" },
```

### Step 4.3 — Create System Health page

Create `apps/web/app/(shell)/admin/system-health/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listAudit, getBuckets, type AuditEvent, type Bucket } from "@/lib/api/audit";

// Known services with ports
const SERVICES = [
  { id: "tenant-svc",    name: "Tenant",       port: 8081 },
  { id: "identity-svc",  name: "Identity",     port: 8082 },
  { id: "project-svc",   name: "Project",      port: 8083 },
  { id: "document-svc",  name: "Document",     port: 8084 },
  { id: "mfg-svc",       name: "Manufacturing",port: 8085 },
  { id: "quality-svc",   name: "Quality",      port: 8087 },
  { id: "workflow-svc",  name: "Workflow",     port: 8090 },
  { id: "audit-svc",     name: "Audit",        port: 8089 },
  { id: "hr-svc",        name: "HR",           port: 8096 },
  { id: "sales-svc",     name: "Sales",        port: 8094 },
  { id: "accounting-svc",name: "Accounting",   port: 8095 },
  { id: "reports-svc",   name: "Reports",      port: 8092 },
];

export default function SystemHealthPage() {
  const [recentEvents, setRecentEvents] = useState<AuditEvent[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listAudit({ limit: 20 }).then(r => setRecentEvents(r.items)),
      getBuckets(14).then(setBuckets),
    ]).finally(() => setLoading(false));
  }, []);

  // Event counts per service (last 14 days)
  const serviceActivity = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of buckets) {
      m.set(b.service, (m.get(b.service) ?? 0) + b.count);
    }
    return m;
  }, [buckets]);

  // Activity series per day (last 7 days total)
  const dailyTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of buckets) {
      m.set(b.day, (m.get(b.day) ?? 0) + b.count);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
  }, [buckets]);

  const maxDaily = Math.max(1, ...dailyTotals.map(([, c]) => c));

  // Count events by result
  const successCount = recentEvents.filter(e => e.result === "ok" || e.result === "allow").length;
  const errorCount = recentEvents.filter(e => e.result !== "ok" && e.result !== "allow").length;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Admin" }, { label: "System Health" }]} />

      {/* KPI tiles */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Services</div>
          <div className="text-2xl font-mono font-bold">{SERVICES.length}</div>
          <div className="text-xs text-muted-foreground mt-1">registered</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Events (14d)</div>
          <div className="text-2xl font-mono font-bold">{buckets.reduce((s, b) => s + b.count, 0)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Success (recent)</div>
          <div className="text-2xl font-mono font-bold text-green-600">{successCount}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Errors (recent)</div>
          <div className={`text-2xl font-mono font-bold ${errorCount > 0 ? "text-red-600" : "text-green-600"}`}>{errorCount}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Activity bar chart (7 days) */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-medium mb-3">Daily Activity (7 days)</h3>
          {dailyTotals.length === 0 ? (
            <div className="text-xs text-muted-foreground">No data</div>
          ) : (
            <div className="flex items-end gap-1 h-24">
              {dailyTotals.map(([day, count]) => (
                <div key={day} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-accent/70 rounded-t"
                    style={{ height: `${Math.round(count / maxDaily * 80)}px` }}
                  />
                  <div className="text-xs text-muted-foreground" style={{ fontSize: "9px" }}>
                    {day.slice(5)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Service activity */}
        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="text-sm font-medium mb-3">Activity by Service (14d)</h3>
          <div className="space-y-1.5">
            {SERVICES.map(svc => {
              const count = serviceActivity.get(svc.id) ?? 0;
              const maxCount = Math.max(1, ...serviceActivity.values());
              return (
                <div key={svc.id} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-24 truncate">{svc.name}</span>
                  <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-accent/60 rounded-full" style={{ width: `${count / maxCount * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent audit events */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="px-4 py-3 bg-muted/50 text-sm font-medium">Recent Events</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Service</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
                <th className="px-4 py-2 text-left font-medium">Entity</th>
                <th className="px-4 py-2 text-left font-medium">Result</th>
                <th className="px-4 py-2 text-left font-medium">User</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No recent events</td></tr>
              )}
              {recentEvents.map(ev => (
                <tr key={ev.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{new Date(ev.ts).toLocaleTimeString()}</td>
                  <td className="px-4 py-2 text-xs">{ev.service}</td>
                  <td className="px-4 py-2 text-xs font-mono">{ev.action}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{ev.entityType}</td>
                  <td className="px-4 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${ev.result === "ok" || ev.result === "allow" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {ev.result}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground font-mono">{ev.userId?.slice(0, 8)}</td>
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
