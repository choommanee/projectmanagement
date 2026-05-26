# Plan #25 — Capacity Planning, Sales Shipments, HR Org Chart, Accounting Budget

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** MFG Capacity Planning view (work center load vs capacity), Sales Shipments tracking, HR visual Org Chart, Accounting Budget vs Actuals page.

**Architecture:**
- Capacity: client-side computation from WOs + work center capacityPerDayHrs, 4-week rolling view
- Shipments: new Sales Hub page + proxy to sales-svc `/v1/shipments`
- Org Chart: pure CSS tree — no extra library, recursive department→position→employee nodes
- Budget: new Accounting page with account groups + budget vs actual comparison

**Tech Stack:** Next.js 15, React 19, Tailwind 4, `@pmplatform/ui-kit`

---

## Task 1: MFG — Capacity Planning

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Capacity Planning to MFG nav)
- Create: `apps/web/app/(shell)/mfg/capacity/page.tsx`

### Step 1.1 — Read existing types

Read `apps/web/src/lib/api/mfg.ts` to understand:
- `WorkCenter` fields: `id`, `name`, `capacityPerDayHrs` (camelCase), `machineCount`, `status`
- `WorkOrder` fields: `id`, `workCenterId` (camelCase), `status`, `plannedStart`, `plannedEnd`, `qty`
- `WOOperation` fields (from `listWoOperations`) — check field names
- `listWorkCenters()` and `listWorkOrders()` return types

### Step 1.2 — Add Capacity Planning to MFG nav

Open `apps/web/src/lib/mock/apps.ts`. Find MFG Hub's production area. Add after Scheduling:

```typescript
{ id: "capacity", name: "Capacity Planning", href: "/mfg/capacity", icon: "dashboard" },
```

### Step 1.3 — Create Capacity Planning page

The page shows a 4-week rolling grid: rows = work centers, columns = weeks, cells = load hours / capacity hours.

Create `apps/web/app/(shell)/mfg/capacity/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listWorkCenters, listWorkOrders, type WorkCenter, type WorkOrder } from "@/lib/api/mfg";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addWeeks(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n * 7);
  return d;
}

function weekLabel(date: Date): string {
  return `${date.toLocaleDateString("en", { month: "short", day: "numeric" })}`;
}

function loadColor(ratio: number): string {
  if (ratio >= 1.0) return "bg-danger text-white";
  if (ratio >= 0.8) return "bg-warning text-ink";
  if (ratio >= 0.5) return "bg-info/20 text-info";
  return "bg-success/10 text-success";
}

function woOverlapsWeek(wo: WorkOrder, weekStart: Date, weekEnd: Date): boolean {
  const start = wo.plannedStart ? new Date(wo.plannedStart) : null;
  const end = wo.plannedEnd ? new Date(wo.plannedEnd) : null;
  if (!start) return false;
  const woEnd = end ?? new Date(start.getTime() + 86400000 * 5);
  return start < weekEnd && woEnd >= weekStart;
}

function estimateWOHours(wo: WorkOrder): number {
  // Estimate: qty * 1 hour per unit (rough default when no routing data)
  return (wo.qty ?? 1) * 1;
}

// ─── Component ───────────────────────────────────────────────────────────────

const WEEKS = 4;

export default function CapacityPlanningPage() {
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    Promise.allSettled([listWorkCenters(), listWorkOrders()])
      .then(([wcs, wos]) => {
        setWorkCenters(wcs.status === "fulfilled" ? wcs.value : []);
        const items = wos.status === "fulfilled"
          ? (Array.isArray(wos.value) ? wos.value : (wos.value as { items: WorkOrder[] }).items ?? [])
          : [];
        setWorkOrders(items.filter((w) => w.status !== "cancelled" && w.status !== "closed" && w.status !== "completed"));
      })
      .finally(() => setLoading(false));
  }, []);

  const weeks = useMemo(() => {
    const base = getWeekStart(new Date());
    return Array.from({ length: WEEKS }, (_, i) => {
      const start = addWeeks(base, i + weekOffset);
      const end = addWeeks(start, 1);
      return { start, end, label: weekLabel(start) };
    });
  }, [weekOffset]);

  const grid = useMemo(() => {
    return workCenters.filter((wc) => wc.status !== "inactive").map((wc) => {
      const capacityHrs = (wc.capacityPerDayHrs ?? 8) * 5; // 5 working days per week
      const weekLoads = weeks.map(({ start, end }) => {
        const wcWOs = workOrders.filter((wo) => (wo.workCenterId ?? wo.work_center_id) === wc.id && woOverlapsWeek(wo, start, end));
        const loadHrs = wcWOs.reduce((s, wo) => s + estimateWOHours(wo), 0);
        return { loadHrs, capacityHrs, ratio: capacityHrs > 0 ? loadHrs / capacityHrs : 0, woCount: wcWOs.length };
      });
      return { wc, weekLoads };
    });
  }, [workCenters, workOrders, weeks]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: "MFG", href: "/mfg/home" }, { label: "Capacity Planning" }]} />

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Capacity Planning</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset((o) => o - 1)}
            className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface-2 transition-colors">← Previous</button>
          <button onClick={() => setWeekOffset(0)}
            className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface-2 transition-colors">Today</button>
          <button onClick={() => setWeekOffset((o) => o + 1)}
            className="rounded border border-line px-3 py-1.5 text-sm hover:bg-surface-2 transition-colors">Next →</button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-ink-muted">
        {[
          { color: "bg-success/10", label: "< 50% loaded" },
          { color: "bg-info/20",    label: "50–80%" },
          { color: "bg-warning",    label: "80–100%" },
          { color: "bg-danger",     label: "Over capacity" },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className={`w-3 h-3 rounded-sm ${color}`} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {loading ? <p className="text-sm text-ink-muted">Loading…</p> : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium w-48">Work Center</th>
                <th className="px-4 py-2 text-center text-xs text-ink-muted w-20">Capacity/wk</th>
                {weeks.map((w) => (
                  <th key={w.start.toISOString()} className="px-4 py-2 text-center font-medium">
                    Week of {w.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {grid.length === 0 ? (
                <tr><td colSpan={2 + WEEKS} className="px-4 py-6 text-center text-ink-muted">No work centers configured.</td></tr>
              ) : grid.map(({ wc, weekLoads }) => (
                <tr key={wc.id} className="hover:bg-surface-2/30">
                  <td className="px-4 py-3">
                    <p className="font-medium">{wc.name}</p>
                    <p className="text-xs text-ink-muted">{wc.type}</p>
                  </td>
                  <td className="px-4 py-3 text-center font-mono text-xs text-ink-muted">
                    {wc.capacityPerDayHrs ?? 8}h/day
                  </td>
                  {weekLoads.map((load, i) => (
                    <td key={i} className="px-2 py-2">
                      <div className={`rounded px-2 py-2 text-center ${loadColor(load.ratio)}`}>
                        <div className="font-mono text-sm font-semibold">{Math.round(load.ratio * 100)}%</div>
                        <div className="text-xs mt-0.5">{load.loadHrs.toFixed(0)}h / {load.capacityHrs}h</div>
                        <div className="text-xs opacity-70">{load.woCount} WOs</div>
                      </div>
                    </td>
                  ))}
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

### Step 1.4 — Commit

```bash
git add "apps/web/app/(shell)/mfg/capacity/" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan25): MFG Capacity Planning — 4-week work center load vs capacity grid"
```

---

## Task 2: Sales — Shipments Page

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Shipments to Sales nav)
- Modify: `apps/web/src/lib/api/sales.ts` (add shipment types + functions)
- Create: `apps/web/app/(shell)/sales/shipments/page.tsx`
- Create: `apps/web/app/api/sales/shipments/route.ts`
- Create: `apps/web/app/api/sales/shipments/[id]/route.ts`

### Step 2.1 — Read sales.ts first

Read `apps/web/src/lib/api/sales.ts` to understand existing SOStatus and patterns.

### Step 2.2 — Add Shipments to Sales nav

Open `apps/web/src/lib/mock/apps.ts`. Find the Sales Hub CRM group. Add after Invoices:

```typescript
{ id: "shipments", name: "Shipments", href: "/sales/shipments", icon: "warehouse" },
```

### Step 2.3 — Add shipment types and functions to sales.ts

Append to `apps/web/src/lib/api/sales.ts`:

```typescript
export type ShipmentStatus = "pending" | "packed" | "shipped" | "delivered" | "returned";

export interface Shipment {
  id: string;
  code?: string;
  so_id?: string;
  so_code?: string;
  customer_id?: string;
  customer_name?: string;
  ship_date?: string;
  carrier?: string;
  tracking_no?: string;
  status: ShipmentStatus;
  delivery_address?: string;
  notes?: string;
  created_at?: string;
}

export async function listShipments(params?: { status?: string; so_id?: string }): Promise<Shipment[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.so_id) q.set("so_id", params.so_id);
  const r = await fetch(`/api/sales/shipments?${q}`);
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.shipments ?? [];
}

export async function createShipment(body: {
  so_id: string;
  ship_date?: string;
  carrier?: string;
  tracking_no?: string;
  delivery_address?: string;
  notes?: string;
}): Promise<Shipment> {
  const r = await fetch("/api/sales/shipments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateShipmentStatus(id: string, status: ShipmentStatus, tracking_no?: string): Promise<void> {
  const r = await fetch(`/api/sales/shipments/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, tracking_no }),
  });
  if (!r.ok) throw new Error(await r.text());
}
```

### Step 2.4 — Create proxy routes

Create `apps/web/app/api/sales/shipments/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SALES_URL = process.env.SALES_URL ?? "http://localhost:8094";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${SALES_URL}/v1/shipments${url.search}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SALES_URL}/v1/shipments`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

Create `apps/web/app/api/sales/shipments/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SALES_URL = process.env.SALES_URL ?? "http://localhost:8094";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SALES_URL}/v1/shipments/${id}`, { method: "PATCH", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

### Step 2.5 — Create Shipments page

Create `apps/web/app/(shell)/sales/shipments/page.tsx`:

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listShipments, createShipment, updateShipmentStatus, listSalesOrders,
  type Shipment, type ShipmentStatus, type SalesOrder,
} from "@/lib/api/sales";

const STATUS_OPTS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "packed", label: "Packed" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "returned", label: "Returned" },
];

function statusTone(s: string): "neutral" | "info" | "accent" | "success" | "danger" | "warning" {
  if (s === "pending") return "neutral";
  if (s === "packed") return "info";
  if (s === "shipped") return "accent";
  if (s === "delivered") return "success";
  if (s === "returned") return "danger";
  return "neutral";
}

function NewShipmentDialog({
  open, orders, onClose, onCreated,
}: { open: boolean; orders: SalesOrder[]; onClose: () => void; onCreated: (s: Shipment) => void }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ so_id: "", ship_date: today, carrier: "", tracking_no: "", delivery_address: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ so_id: orders[0]?.id ?? "", ship_date: today, carrier: "", tracking_no: "", delivery_address: "", notes: "" });
      setError(null);
    }
  }, [open, orders, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.so_id) { setError("Sales Order required"); return; }
    setLoading(true);
    try {
      const s = await createShipment({
        so_id: form.so_id,
        ship_date: form.ship_date || undefined,
        carrier: form.carrier || undefined,
        tracking_no: form.tracking_no || undefined,
        delivery_address: form.delivery_address || undefined,
        notes: form.notes || undefined,
      });
      onCreated(s);
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Shipment">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[360px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Sales Order *</span>
          <select value={form.so_id} onChange={(e) => setForm((f) => ({ ...f, so_id: e.target.value }))}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent">
            {orders.map((o) => <option key={o.id} value={o.id}>{o.soNumber ?? o.id.slice(0, 8)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Ship Date</span>
          <Input type="date" value={form.ship_date} onChange={(e) => setForm((f) => ({ ...f, ship_date: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Carrier</span>
          <Input value={form.carrier} onChange={(e) => setForm((f) => ({ ...f, carrier: e.target.value }))} placeholder="DHL, FedEx, Kerry…" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Tracking No.</span>
          <Input value={form.tracking_no} onChange={(e) => setForm((f) => ({ ...f, tracking_no: e.target.value }))} placeholder="TH123456789" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Delivery Address</span>
          <Input value={form.delivery_address} onChange={(e) => setForm((f) => ({ ...f, delivery_address: e.target.value }))} placeholder="123 Main St…" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create Shipment"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function SalesShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      listShipments(statusFilter ? { status: statusFilter } : undefined),
      listSalesOrders({ status: "confirmed" }),
    ]).then(([sr, or]) => {
      setShipments(sr.status === "fulfilled" ? sr.value : []);
      const soResult = or.status === "fulfilled" ? or.value : { items: [], total: 0 };
      setOrders(Array.isArray(soResult) ? soResult : soResult.items ?? []);
    }).finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function advanceStatus(s: Shipment) {
    const next: Record<ShipmentStatus, ShipmentStatus | null> = {
      pending: "packed", packed: "shipped", shipped: "delivered", delivered: null, returned: null,
    };
    const nextStatus = next[s.status];
    if (!nextStatus) return;
    setProcessing(s.id);
    try { await updateShipmentStatus(s.id, nextStatus); load(); } finally { setProcessing(null); }
  }

  const nextLabel: Record<ShipmentStatus, string | null> = {
    pending: "Pack", packed: "Ship", shipped: "Deliver", delivered: null, returned: null,
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Sales", href: "/sales/home" }, { label: "Shipments" }]} />
      <CommandBar title="Shipments" actions={[{ id: "new", label: "New Shipment", icon: "plus", onClick: () => setNewOpen(true) }]} />

      <div className="flex gap-2 flex-wrap">
        {STATUS_OPTS.map((opt) => (
          <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
            className={`rounded px-3 py-1 text-sm font-medium transition-colors ${statusFilter === opt.value ? "bg-accent text-white" : "bg-surface-2 text-ink hover:bg-surface-3"}`}>
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-ink-muted">Loading…</p> : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Code</th>
                <th className="px-4 py-2 text-left font-medium">SO</th>
                <th className="px-4 py-2 text-left font-medium">Customer</th>
                <th className="px-4 py-2 text-left font-medium">Ship Date</th>
                <th className="px-4 py-2 text-left font-medium">Carrier</th>
                <th className="px-4 py-2 text-left font-medium">Tracking</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shipments.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-ink-muted">No shipments found.</td></tr>
              ) : shipments.map((s) => (
                <tr key={s.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-mono text-xs">{s.code ?? s.id.slice(0, 8)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted">{s.so_code ?? s.so_id?.slice(0, 8) ?? "—"}</td>
                  <td className="px-4 py-2">{s.customer_name ?? "—"}</td>
                  <td className="px-4 py-2 text-ink-muted">{s.ship_date ? new Date(s.ship_date).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2 text-ink-muted">{s.carrier ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-accent">{s.tracking_no ?? "—"}</td>
                  <td className="px-4 py-2"><Tag tone={statusTone(s.status)} size="sm">{s.status}</Tag></td>
                  <td className="px-4 py-2">
                    {nextLabel[s.status] && (
                      <Button size="sm" variant="ghost" onClick={() => advanceStatus(s)} disabled={processing === s.id}>
                        {nextLabel[s.status]}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewShipmentDialog open={newOpen} orders={orders} onClose={() => setNewOpen(false)}
        onCreated={(s) => { setShipments((p) => [s, ...p]); setNewOpen(false); }} />
    </div>
  );
}
```

**Note:** `SalesOrder` may use camelCase `soNumber` — check the actual field in sales.ts and use correct name.

### Step 2.6 — Commit

```bash
git add "apps/web/app/(shell)/sales/shipments/" "apps/web/app/api/sales/shipments/" "apps/web/src/lib/api/sales.ts" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan25): Sales Shipments — pending → packed → shipped → delivered flow"
```

---

## Task 3: HR — Visual Org Chart

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Org Chart to HR nav)
- Create: `apps/web/app/(shell)/hr/org-chart/page.tsx`

### Step 3.1 — Add Org Chart to HR nav

Open `apps/web/src/lib/mock/apps.ts`. Find the HR Hub `org` area. Add:

```typescript
{ id: "org-chart", name: "Org Chart", href: "/hr/org-chart", icon: "people" },
```

Add it as the first subarea in the org Structure group.

### Step 3.2 — Read HR types

Read `apps/web/src/lib/api/hr.ts` to understand:
- `Department` type: `id`, `name`, `parentId` (or `parent_id`) fields
- `Employee` type: `id`, `departmentId`, `positionId`, actual name fields (`firstName`, `lastName` etc.)
- `listDepartments()` and `listEmployees()` return types

### Step 3.3 — Create Org Chart page

Create `apps/web/app/(shell)/hr/org-chart/page.tsx`. Use pure CSS tree (no external library).

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listDepartments, listEmployees, type Department, type Employee } from "@/lib/api/hr";

// ─── Tree node types ──────────────────────────────────────────────────────────

interface DeptNode {
  dept: Department;
  employees: Employee[];
  children: DeptNode[];
}

function buildTree(departments: Department[], employees: Employee[]): DeptNode[] {
  const nodeMap = new Map<string, DeptNode>();
  departments.forEach((d) => nodeMap.set(d.id, { dept: d, employees: [], children: [] }));

  // Attach employees to departments
  employees.forEach((emp) => {
    const deptId = emp.departmentId ?? emp.department_id;
    if (deptId && nodeMap.has(deptId)) {
      nodeMap.get(deptId)!.employees.push(emp);
    }
  });

  // Build parent-child relationships
  const roots: DeptNode[] = [];
  nodeMap.forEach((node) => {
    const parentId = node.dept.parentId ?? node.dept.parent_id;
    if (parentId && nodeMap.has(parentId)) {
      nodeMap.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
}

// ─── Org Node Component ───────────────────────────────────────────────────────

function OrgNode({ node, depth = 0 }: { node: DeptNode; depth?: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div className="flex flex-col items-center">
      {/* Department box */}
      <div className="relative">
        <div
          className={`rounded-lg border-2 bg-surface px-4 py-3 min-w-[180px] text-center shadow-sm cursor-pointer hover:border-accent/50 transition-colors ${depth === 0 ? "border-accent" : "border-line"}`}
          onClick={() => hasChildren && setCollapsed((c) => !c)}
        >
          <p className="font-semibold text-sm">{node.dept.name}</p>
          <p className="text-xs text-ink-muted mt-0.5">
            {node.employees.length} employee{node.employees.length !== 1 ? "s" : ""}
          </p>
          {hasChildren && (
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs text-accent">
              {collapsed ? "▼" : "▲"}
            </span>
          )}
        </div>

        {/* Employee mini chips */}
        {node.employees.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1 justify-center max-w-[200px] mx-auto">
            {node.employees.slice(0, 3).map((emp) => (
              <span key={emp.id} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-muted border border-line">
                {(emp.firstName ?? emp.first_name ?? "").charAt(0)}.{emp.lastName ?? emp.last_name ?? emp.id.slice(0, 4)}
              </span>
            ))}
            {node.employees.length > 3 && (
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-ink-muted border border-line">
                +{node.employees.length - 3}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Connector + children */}
      {!collapsed && node.children.length > 0 && (
        <div className="flex flex-col items-center">
          <div className="w-px h-8 bg-line" />
          <div className="flex gap-8 items-start">
            {node.children.map((child, i) => (
              <div key={child.dept.id} className="flex flex-col items-center">
                {node.children.length > 1 && (
                  <div className={`h-px w-full bg-line ${i === 0 ? "ml-1/2" : ""}`} />
                )}
                <OrgNode node={child} depth={depth + 1} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HROrgChartPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([listDepartments(), listEmployees()])
      .then(([dr, er]) => {
        setDepartments(dr.status === "fulfilled" ? (Array.isArray(dr.value) ? dr.value : dr.value.items ?? []) : []);
        const empResult = er.status === "fulfilled" ? er.value : { items: [], total: 0 };
        setEmployees(Array.isArray(empResult) ? empResult : empResult.items ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  const tree = useMemo(() => buildTree(departments, employees), [departments, employees]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: "HR", href: "/hr/home" }, { label: "Org Chart" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Org Chart</h1>
        <div className="text-sm text-ink-muted">
          {departments.length} departments · {employees.length} employees
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : tree.length === 0 ? (
        <p className="text-sm text-ink-muted">No departments configured.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="flex gap-12 p-4 min-w-max">
            {tree.map((root) => (
              <OrgNode key={root.dept.id} node={root} depth={0} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 3.4 — Commit

```bash
git add "apps/web/app/(shell)/hr/org-chart/" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan25): HR Org Chart — collapsible department tree with employee count"
```

---

## Task 4: Accounting — Budget vs Actuals

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Budget to Accounting nav)
- Modify: `apps/web/src/lib/api/accounting.ts` (add budget types + functions)
- Create: `apps/web/app/(shell)/accounting/budget/page.tsx`
- Create: `apps/web/app/api/accounting/budget/route.ts`

### Step 4.1 — Read accounting.ts and mock/apps.ts

Read `apps/web/src/lib/api/accounting.ts` to understand Account types. Read `apps/web/src/lib/mock/apps.ts` to find Accounting Hub nav.

### Step 4.2 — Add Budget to Accounting nav

Find the Accounting Hub in mock/apps.ts. Add:

```typescript
{ id: "budget", name: "Budget", href: "/accounting/budget", icon: "dashboard" },
```

Add it in the Reports area or alongside existing Accounting entries.

### Step 4.3 — Add budget API functions to accounting.ts

Append to `apps/web/src/lib/api/accounting.ts`:

```typescript
export interface BudgetLine {
  id: string;
  account_id: string;
  account_code?: string;
  account_name?: string;
  account_type?: string;
  budget_amount: number;
  period: string; // "2026-05" format
}

export async function listBudgetLines(period?: string): Promise<BudgetLine[]> {
  const q = period ? `?period=${period}` : "";
  const r = await fetch(`/api/accounting/budget${q}`);
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.lines ?? [];
}

export async function setBudgetLine(body: { account_id: string; budget_amount: number; period: string }): Promise<BudgetLine> {
  const r = await fetch("/api/accounting/budget", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
```

### Step 4.4 — Create budget proxy route

Create `apps/web/app/api/accounting/budget/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const ACCOUNTING_URL = process.env.ACCOUNTING_URL ?? "http://localhost:8095";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${ACCOUNTING_URL}/v1/budget${url.search}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${ACCOUNTING_URL}/v1/budget`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

### Step 4.5 — Create Budget vs Actuals page

Read `apps/web/src/lib/api/accounting.ts` to understand `Account`, `JournalEntry`, and `groupLinesByAccount`/`computeAccountBalance` helpers.

Create `apps/web/app/(shell)/accounting/budget/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button } from "@pmplatform/ui-kit";
import {
  listAccounts, listJournalEntries, listBudgetLines, setBudgetLine,
  computeAccountBalance, groupLinesByAccount,
  type Account, type BudgetLine,
} from "@/lib/api/accounting";

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function varianceColor(v: number): string {
  if (v > 0) return "text-success";
  if (v < 0) return "text-danger";
  return "text-ink-muted";
}

function pctBar(actual: number, budget: number): number {
  if (budget === 0) return 0;
  return Math.min(Math.round((actual / budget) * 100), 100);
}

export default function AccountingBudgetPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [entries, setEntries] = useState<ReturnType<typeof listJournalEntries> extends Promise<infer T> ? T : never>([]);
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([listAccounts(), listJournalEntries(), listBudgetLines(period)])
      .then(([ar, er, br]) => {
        setAccounts(ar.status === "fulfilled" ? (Array.isArray(ar.value) ? ar.value : ar.value.accounts ?? []) : []);
        setEntries(er.status === "fulfilled" ? (Array.isArray(er.value) ? er.value : er.value.entries ?? []) : []);
        setBudgetLines(br.status === "fulfilled" ? br.value : []);
      })
      .finally(() => setLoading(false));
  }, [period]);

  // Group journal entry lines by account
  const allLines = useMemo(() => entries.flatMap((je: { lines?: unknown[] }) => je.lines ?? []), [entries]);

  const rows = useMemo(() => {
    return accounts.map((acc) => {
      const bal = computeAccountBalance(allLines as Parameters<typeof computeAccountBalance>[0], acc.id, acc.normalSide ?? acc.normal_side ?? "debit");
      const actual = Math.abs(bal.balance);
      const budgetLine = budgetLines.find((b) => b.account_id === acc.id);
      const budget = budgetLine?.budget_amount ?? 0;
      const variance = budget - actual;
      return { acc, actual, budget, variance, pct: pctBar(actual, budget) };
    }).filter((r) => r.actual > 0 || r.budget > 0);
  }, [accounts, allLines, budgetLines]);

  async function saveBudget(accountId: string) {
    const amount = parseFloat(editValue);
    if (isNaN(amount)) return;
    await setBudgetLine({ account_id: accountId, budget_amount: amount, period });
    setBudgetLines((prev) => {
      const existing = prev.findIndex((b) => b.account_id === accountId);
      if (existing >= 0) return prev.map((b, i) => i === existing ? { ...b, budget_amount: amount } : b);
      return [...prev, { id: accountId, account_id: accountId, budget_amount: amount, period }];
    });
    setEditingId(null);
  }

  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Accounting", href: "/accounting/home" }, { label: "Budget" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Budget vs Actuals</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-muted">Period:</span>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)}
            className="rounded border border-line bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total Budget", value: fmt(totalBudget), color: "text-ink" },
          { label: "Total Actual", value: fmt(totalActual), color: totalActual > totalBudget ? "text-danger" : "text-success" },
          { label: "Variance", value: fmt(totalBudget - totalActual), color: varianceColor(totalBudget - totalActual) },
        ].map((t) => (
          <div key={t.label} className="rounded-sm border border-line bg-surface p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{t.label}</p>
            <p className={`font-mono text-2xl font-bold ${t.color}`}>{t.value}</p>
          </div>
        ))}
      </div>

      {loading ? <p className="text-sm text-ink-muted">Loading…</p> : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Account</th>
                <th className="px-4 py-2 text-left font-medium">Type</th>
                <th className="px-4 py-2 text-right font-medium">Budget</th>
                <th className="px-4 py-2 text-right font-medium">Actual</th>
                <th className="px-4 py-2 text-right font-medium">Variance</th>
                <th className="px-4 py-2 text-center font-medium w-32">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-muted">No accounts with activity or budget.</td></tr>
              ) : rows.map(({ acc, actual, budget, variance, pct }) => (
                <tr key={acc.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2">
                    <p className="font-medium">{acc.name}</p>
                    <p className="font-mono text-xs text-ink-muted">{acc.code}</p>
                  </td>
                  <td className="px-4 py-2 text-ink-muted capitalize">{acc.type ?? acc.accountType}</td>
                  <td className="px-4 py-2 text-right">
                    {editingId === acc.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <input type="number" value={editValue} onChange={(e) => setEditValue(e.target.value)}
                          className="w-24 rounded border border-accent px-2 py-0.5 text-right text-sm focus:outline-none" autoFocus
                          onKeyDown={(e) => { if (e.key === "Enter") saveBudget(acc.id); if (e.key === "Escape") setEditingId(null); }} />
                        <button onClick={() => saveBudget(acc.id)} className="text-xs text-success">✓</button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-danger">✕</button>
                      </div>
                    ) : (
                      <button onClick={() => { setEditingId(acc.id); setEditValue(String(budget)); }}
                        className="font-mono hover:text-accent transition-colors" title="Click to edit budget">
                        {fmt(budget)}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(actual)}</td>
                  <td className={`px-4 py-2 text-right font-mono font-semibold ${varianceColor(variance)}`}>
                    {variance > 0 ? "+" : ""}{fmt(variance)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-surface-3">
                        <div className={`h-1.5 rounded-full ${pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success"}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-mono w-8 text-right text-ink-muted">{pct}%</span>
                    </div>
                  </td>
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

### Step 4.6 — Commit

```bash
git add "apps/web/app/(shell)/accounting/budget/" "apps/web/app/api/accounting/budget/" "apps/web/src/lib/api/accounting.ts" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan25): Accounting Budget vs Actuals — inline budget editing, progress bars"
```

---

## Task 5: Typecheck

```bash
pnpm --filter web typecheck 2>&1 | tail -20
```

Fix all errors. Common issues:
- `listDepartments()` return type — may return `{ items, total }` or array
- `listJournalEntries()` return type — check actual function signature in accounting.ts
- `Account.normalSide` vs `normal_side` — use optional chaining
- `SalesOrder.soNumber` — verify actual field name
- `WorkOrder.workCenterId` vs `work_center_id` — use `??` both
- `WorkCenter.capacityPerDayHrs` — verify from the type definition
