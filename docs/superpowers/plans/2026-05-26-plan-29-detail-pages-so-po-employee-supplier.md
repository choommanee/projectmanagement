# Plan #29 — Detail Pages: Sales Order, Purchase Order, Employee, Supplier

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clickable row navigation and full detail pages for Sales Orders, Purchase Orders, Employees, and Suppliers — turning list views into actionable drill-down workflows.

**Architecture:** Each detail page uses the existing typed API functions. List pages get `useRouter` + `onClick` row handlers. No new backend proxy routes needed — all APIs already proxy through `apps/web/app/api/`.

**Tech Stack:** Next.js 15 App Router, React 19, Tailwind 4, `@pmplatform/ui-kit`, `useParams` for dynamic segments.

---

## Task 1: Sales Order Detail

**Files:**
- Modify: `apps/web/app/(shell)/sales/orders/page.tsx` (add row click)
- Create: `apps/web/app/(shell)/sales/orders/[id]/page.tsx`

### API facts (READ sales.ts to confirm before writing):
- `getSalesOrder(id)` → `SalesOrder` with `soNumber`, `customerId`, `status: SOStatus`, `orderDate`, `requestedDate`, `notes`, `lines: SOLine[]`
- `SOLine`: `id`, `itemDesc`, `lineNo`, `qtyOrdered`, `qtyShipped`, `unitPrice` (all camelCase)
- `getCustomer(customerId)` → `Customer` with `name`, `code`, `email`, `phone`
- `updateSalesOrder(id, { status?, requested_date?, notes? })` → `SalesOrder`
- `addSOLine(soId, { item_desc, qty_ordered, unit_price?, notes? })` → `SOLine`
- `SOStatus` values: `"draft" | "confirmed" | "shipped" | "invoiced" | "cancelled"`

### Step 1.1 — Add row click to orders list

Read `apps/web/app/(shell)/sales/orders/page.tsx`. Add `useRouter` from `"next/navigation"` and `onClick={() => router.push('/sales/orders/' + o.id)}` + `cursor-pointer` to each order table row.

### Step 1.2 — Create Sales Order Detail page

Create `apps/web/app/(shell)/sales/orders/[id]/page.tsx`:

```typescript
"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getSalesOrder, getCustomer, updateSalesOrder, addSOLine,
  type SalesOrder, type SOLine, type Customer, type SOStatus,
} from "@/lib/api/sales";

const STATUS_FLOW: SOStatus[] = ["draft", "confirmed", "shipped", "invoiced"];
const STATUS_COLORS: Record<SOStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  confirmed: "bg-blue-100 text-blue-700",
  shipped: "bg-amber-100 text-amber-700",
  invoiced: "bg-indigo-100 text-indigo-700",
  cancelled: "bg-red-100 text-red-600",
};

export default function SalesOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineDesc, setLineDesc] = useState("");
  const [lineQty, setLineQty] = useState("1");
  const [linePrice, setLinePrice] = useState("");

  useEffect(() => {
    if (!id) return;
    getSalesOrder(id).then(o => {
      setOrder(o);
      return getCustomer(o.customerId).then(setCustomer).catch(() => null);
    }).finally(() => setLoading(false));
  }, [id]);

  async function advance() {
    if (!order) return;
    const idx = STATUS_FLOW.indexOf(order.status);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return;
    setSaving(true);
    const updated = await updateSalesOrder(order.id, { status: STATUS_FLOW[idx + 1] }).catch(() => null);
    if (updated) setOrder(updated);
    setSaving(false);
  }

  async function cancel() {
    if (!order) return;
    setSaving(true);
    const updated = await updateSalesOrder(order.id, { status: "cancelled" }).catch(() => null);
    if (updated) setOrder(updated);
    setSaving(false);
  }

  async function handleAddLine() {
    if (!order || !lineDesc) return;
    const line = await addSOLine(order.id, {
      item_desc: lineDesc,
      qty_ordered: parseFloat(lineQty) || 1,
      unit_price: linePrice ? parseFloat(linePrice) : undefined,
    }).catch(() => null);
    if (line) {
      setOrder(prev => prev ? { ...prev, lines: [...prev.lines, line] } : prev);
      setLineDesc(""); setLineQty("1"); setLinePrice(""); setShowAddLine(false);
    }
  }

  const lineTotal = (l: SOLine) => l.qtyOrdered * l.unitPrice;
  const orderTotal = order?.lines.reduce((s, l) => s + lineTotal(l), 0) ?? 0;
  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!order) return <div className="p-6 text-sm text-red-600">Order not found</div>;

  const canAdvance = STATUS_FLOW.includes(order.status) && order.status !== "invoiced";

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Sales" }, { label: "Orders", href: "/sales/orders" }, { label: order.soNumber }]} />

      {/* Header */}
      <div className="rounded-lg border border-border bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold font-mono">{order.soNumber}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status]}`}>{order.status}</span>
          </div>
          <div className="text-sm text-muted-foreground space-y-0.5">
            {customer && <div className="font-medium text-foreground">{customer.name} <span className="text-xs text-muted-foreground">({customer.code})</span></div>}
            <div>Order date: {order.orderDate?.slice(0, 10)}</div>
            {order.requestedDate && <div>Requested: {order.requestedDate.slice(0, 10)}</div>}
            {order.notes && <div className="text-xs mt-1">{order.notes}</div>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {canAdvance && (
            <button onClick={advance} disabled={saving} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              → {STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1]}
            </button>
          )}
          {order.status === "draft" && (
            <button onClick={cancel} disabled={saving} className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">
              Cancel
            </button>
          )}
          <button onClick={() => router.back()} className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground">← Back</button>
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-muted/50">
          <span className="text-sm font-medium">Order Lines ({order.lines.length})</span>
          {order.status === "draft" && (
            <button onClick={() => setShowAddLine(true)} className="text-xs px-2 py-1 rounded bg-accent text-white hover:bg-accent/90">+ Add Line</button>
          )}
        </div>

        {showAddLine && (
          <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Description</label>
              <input value={lineDesc} onChange={e => setLineDesc(e.target.value)} placeholder="Item description"
                className="w-full mt-0.5 text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div className="w-20">
              <label className="text-xs text-muted-foreground">Qty</label>
              <input type="number" value={lineQty} onChange={e => setLineQty(e.target.value)} min="1"
                className="w-full mt-0.5 text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div className="w-28">
              <label className="text-xs text-muted-foreground">Unit Price</label>
              <input type="number" value={linePrice} onChange={e => setLinePrice(e.target.value)} placeholder="0"
                className="w-full mt-0.5 text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <button onClick={handleAddLine} className="px-2 py-1.5 text-xs rounded bg-accent text-white">Add</button>
            <button onClick={() => setShowAddLine(false)} className="px-2 py-1.5 text-xs rounded border border-border">✕</button>
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
            <tr>
              <th className="px-4 py-2 text-left font-medium">#</th>
              <th className="px-4 py-2 text-left font-medium">Description</th>
              <th className="px-4 py-2 text-right font-medium">Qty Ordered</th>
              <th className="px-4 py-2 text-right font-medium">Qty Shipped</th>
              <th className="px-4 py-2 text-right font-medium">Unit Price</th>
              <th className="px-4 py-2 text-right font-medium">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No lines — add one above</td></tr>}
            {order.lines.map(l => (
              <tr key={l.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-4 py-3 text-xs text-muted-foreground">{l.lineNo}</td>
                <td className="px-4 py-3 text-xs">{l.itemDesc}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{l.qtyOrdered}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{l.qtyShipped}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{fmt(l.unitPrice)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs font-semibold">{fmt(lineTotal(l))}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-border bg-muted/30">
              <td colSpan={5} className="px-4 py-2 text-right text-xs font-medium">Order Total</td>
              <td className="px-4 py-2 text-right font-mono text-sm font-bold">{fmt(orderTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

## Task 2: HR Employee Detail

**Files:**
- Modify: `apps/web/app/(shell)/hr/employees/page.tsx` (add row click)
- Create: `apps/web/app/(shell)/hr/employees/[id]/page.tsx`

### API facts (READ hr.ts to confirm before writing):
- `getEmployee(id)` → `Employee` with `empNo`, `firstName`, `lastName`, `email`, `departmentName`, `positionName`, `status: EmpStatus`, `hireDate`
- `listPayslips({ employee_id: id })` → `{ items: Payslip[]; total }` — unwrap `.items`
- `Payslip`: `id`, `period_start`, `period_end`, `base_salary`, `allowances`, `deductions`, `net_pay`, `status: PayslipStatus`, `currency` (all snake_case)
- `listLeaveRequests({ employee_id: id })` → `{ items: LeaveRequest[]; total }` — unwrap `.items`
- `LeaveRequest`: `id`, `leave_type`, `start_date`, `end_date`, `days`, `status`, `reason` (snake_case)
- `EmpStatus` values: `"active" | "inactive" | "terminated"` (verify in hr.ts)

### Step 2.1 — Add row click to employees list

Read `apps/web/app/(shell)/hr/employees/page.tsx`. Add `useRouter` and `onClick` row click to push to `/hr/employees/` + employee id.

### Step 2.2 — Create Employee Detail page

Create `apps/web/app/(shell)/hr/employees/[id]/page.tsx`:

```typescript
"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getEmployee, listPayslips, listLeaveRequests,
  type Employee, type Payslip, type LeaveRequest,
} from "@/lib/api/hr";

type Tab = "overview" | "payslips" | "leave";

const LEAVE_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-600",
  cancelled: "bg-zinc-100 text-zinc-500",
};

const PAYSLIP_COLORS: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
};

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getEmployee(id).then(setEmployee),
      listPayslips({ employee_id: id }).then(r => setPayslips(r.items)),
      listLeaveRequests({ employee_id: id }).then(r => setLeaves(r.items)),
    ]).finally(() => setLoading(false));
  }, [id]);

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!employee) return <div className="p-6 text-sm text-red-600">Employee not found</div>;

  const totalDaysLeave = leaves.filter(l => l.status === "approved").reduce((s, l) => s + l.days, 0);
  const lastPayslip = payslips[0];

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Employees", href: "/hr/employees" }, { label: `${employee.firstName} ${employee.lastName}` }]} />

      {/* Employee header */}
      <div className="rounded-lg border border-border bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-semibold">{employee.firstName} {employee.lastName}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${employee.status === "active" ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>{employee.status}</span>
          </div>
          <div className="text-sm text-muted-foreground space-y-0.5">
            <div className="font-mono text-xs">{employee.empNo}</div>
            {employee.positionName && <div>{employee.positionName}</div>}
            {employee.departmentName && <div>{employee.departmentName}</div>}
            <div>{employee.email}</div>
            <div className="text-xs">Hired: {employee.hireDate?.slice(0, 10)}</div>
          </div>
        </div>
        <button onClick={() => router.back()} className="text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded">← Back</button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Payslips</div>
          <div className="text-2xl font-mono font-bold">{payslips.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Leave Days (approved)</div>
          <div className="text-2xl font-mono font-bold">{totalDaysLeave}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Last Net Pay</div>
          <div className="text-2xl font-mono font-bold text-green-600">{lastPayslip ? fmt(lastPayslip.net_pay) : "—"}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["overview", "payslips", "leave"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${tab === t ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}{t === "payslips" ? ` (${payslips.length})` : t === "leave" ? ` (${leaves.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="rounded-lg border border-border bg-surface p-5 grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">Employee #:</span> <span className="font-mono">{employee.empNo}</span></div>
          <div><span className="text-muted-foreground">Status:</span> {employee.status}</div>
          <div><span className="text-muted-foreground">Department:</span> {employee.departmentName ?? "—"}</div>
          <div><span className="text-muted-foreground">Position:</span> {employee.positionName ?? "—"}</div>
          <div><span className="text-muted-foreground">Email:</span> {employee.email}</div>
          <div><span className="text-muted-foreground">Hire Date:</span> {employee.hireDate?.slice(0, 10)}</div>
          {employee.terminationDate && <div><span className="text-muted-foreground">Termination:</span> {employee.terminationDate?.slice(0, 10)}</div>}
        </div>
      )}

      {tab === "payslips" && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Base</th>
                <th className="px-4 py-2 text-right font-medium">Allowances</th>
                <th className="px-4 py-2 text-right font-medium">Deductions</th>
                <th className="px-4 py-2 text-right font-medium">Net Pay</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {payslips.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No payslips</td></tr>}
              {payslips.map(p => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs">{p.period_start?.slice(0, 7)} → {p.period_end?.slice(0, 7)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(p.base_salary)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-green-700">+{fmt(p.allowances)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-red-600">-{fmt(p.deductions)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-bold">{fmt(p.net_pay)}</td>
                  <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-xs ${PAYSLIP_COLORS[p.status] ?? ""}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "leave" && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Type</th>
                <th className="px-4 py-2 text-left font-medium">From</th>
                <th className="px-4 py-2 text-left font-medium">To</th>
                <th className="px-4 py-2 text-right font-medium">Days</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {leaves.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No leave requests</td></tr>}
              {leaves.map(l => (
                <tr key={l.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs capitalize">{l.leave_type.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-xs">{l.start_date?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs">{l.end_date?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{l.days}</td>
                  <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-xs ${LEAVE_COLORS[l.status] ?? ""}`}>{l.status}</span></td>
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

## Task 3: Purchase Order Detail

**Files:**
- Modify: `apps/web/app/(shell)/procurement/purchase-orders/page.tsx` (add row click)
- Create: `apps/web/app/(shell)/procurement/purchase-orders/[id]/page.tsx`

### API facts (READ mfg.ts to confirm before writing):
- `getPurchaseOrder(id)` → `PurchaseOrder` with `poNumber`, `supplierId`, `status`, `orderDate`, `expectedDate`, `notes`, `lines: POLine[]`
- `POLine`: `id`, `itemId`, `lineNo`, `qtyOrdered`, `qtyReceived`, `unitPrice` (camelCase)
- `listSuppliers()` → `Supplier[]` (plain array) — find by `s.id === order.supplierId`
- `updatePurchaseOrder(id, { status?, expected_date?, notes? })` → `PurchaseOrder`
- `addPOLine(poId, { item_id, qty_ordered, unit_price?, notes? })` → `POLine`
- `POStatus` values: `"draft" | "submitted" | "approved" | "received" | "cancelled"`

### Step 3.1 — Add row click to PO list

Read `apps/web/app/(shell)/procurement/purchase-orders/page.tsx`. Add `useRouter` and `onClick` to push to `/procurement/purchase-orders/` + po.id.

### Step 3.2 — Create PO Detail page

Create `apps/web/app/(shell)/procurement/purchase-orders/[id]/page.tsx`:

```typescript
"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getPurchaseOrder, listSuppliers, updatePurchaseOrder, addPOLine,
  type PurchaseOrder, type POLine, type Supplier, type POStatus,
} from "@/lib/api/mfg";

const STATUS_FLOW: POStatus[] = ["draft", "submitted", "approved", "received"];
const STATUS_COLORS: Record<POStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-indigo-100 text-indigo-700",
  received: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddLine, setShowAddLine] = useState(false);
  const [lineItemId, setLineItemId] = useState("");
  const [lineQty, setLineQty] = useState("1");
  const [linePrice, setLinePrice] = useState("");

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getPurchaseOrder(id).then(po => {
        setOrder(po);
        return listSuppliers().then(all => {
          const s = all.find(s => s.id === po.supplierId) ?? null;
          setSupplier(s);
        }).catch(() => null);
      }),
    ]).finally(() => setLoading(false));
  }, [id]);

  async function advance() {
    if (!order) return;
    const idx = STATUS_FLOW.indexOf(order.status as POStatus);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return;
    setSaving(true);
    const updated = await updatePurchaseOrder(order.id, { status: STATUS_FLOW[idx + 1] }).catch(() => null);
    if (updated) setOrder(updated);
    setSaving(false);
  }

  async function cancel() {
    if (!order) return;
    setSaving(true);
    const updated = await updatePurchaseOrder(order.id, { status: "cancelled" }).catch(() => null);
    if (updated) setOrder(updated);
    setSaving(false);
  }

  async function handleAddLine() {
    if (!order || !lineItemId) return;
    const line = await addPOLine(order.id, {
      item_id: lineItemId,
      qty_ordered: parseFloat(lineQty) || 1,
      unit_price: linePrice ? parseFloat(linePrice) : undefined,
    }).catch(() => null);
    if (line) {
      setOrder(prev => prev ? { ...prev, lines: [...prev.lines, line] } : prev);
      setLineItemId(""); setLineQty("1"); setLinePrice(""); setShowAddLine(false);
    }
  }

  const lineTotal = (l: POLine) => l.qtyOrdered * l.unitPrice;
  const orderTotal = order?.lines.reduce((s, l) => s + lineTotal(l), 0) ?? 0;
  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!order) return <div className="p-6 text-sm text-red-600">Purchase order not found</div>;

  const orderStatus = order.status as POStatus;
  const canAdvance = STATUS_FLOW.includes(orderStatus) && orderStatus !== "received";

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Procurement" }, { label: "Purchase Orders", href: "/procurement/purchase-orders" }, { label: order.poNumber }]} />

      {/* Header */}
      <div className="rounded-lg border border-border bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold font-mono">{order.poNumber}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[orderStatus] ?? "bg-zinc-100 text-zinc-600"}`}>{order.status}</span>
          </div>
          <div className="text-sm text-muted-foreground space-y-0.5">
            {supplier && <div className="font-medium text-foreground">{supplier.name} <span className="text-xs text-muted-foreground">({supplier.code})</span></div>}
            <div>Order date: {order.orderDate?.slice(0, 10)}</div>
            {order.expectedDate && <div>Expected: {order.expectedDate.slice(0, 10)}</div>}
            {order.notes && <div className="text-xs mt-1">{order.notes}</div>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {canAdvance && (
            <button onClick={advance} disabled={saving} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              → {STATUS_FLOW[STATUS_FLOW.indexOf(orderStatus) + 1]}
            </button>
          )}
          {order.status === "draft" && (
            <button onClick={cancel} disabled={saving} className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">
              Cancel
            </button>
          )}
          <button onClick={() => router.back()} className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground">← Back</button>
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-muted/50">
          <span className="text-sm font-medium">PO Lines ({order.lines.length})</span>
          {order.status === "draft" && (
            <button onClick={() => setShowAddLine(true)} className="text-xs px-2 py-1 rounded bg-accent text-white hover:bg-accent/90">+ Add Line</button>
          )}
        </div>

        {showAddLine && (
          <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground">Item ID / SKU</label>
              <input value={lineItemId} onChange={e => setLineItemId(e.target.value)} placeholder="Item ID"
                className="w-full mt-0.5 text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div className="w-20">
              <label className="text-xs text-muted-foreground">Qty</label>
              <input type="number" value={lineQty} onChange={e => setLineQty(e.target.value)} min="1"
                className="w-full mt-0.5 text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <div className="w-28">
              <label className="text-xs text-muted-foreground">Unit Price</label>
              <input type="number" value={linePrice} onChange={e => setLinePrice(e.target.value)} placeholder="0"
                className="w-full mt-0.5 text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
            <button onClick={handleAddLine} className="px-2 py-1.5 text-xs rounded bg-accent text-white">Add</button>
            <button onClick={() => setShowAddLine(false)} className="px-2 py-1.5 text-xs rounded border border-border">✕</button>
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
            <tr>
              <th className="px-4 py-2 text-left font-medium">#</th>
              <th className="px-4 py-2 text-left font-medium">Item ID</th>
              <th className="px-4 py-2 text-right font-medium">Qty Ordered</th>
              <th className="px-4 py-2 text-right font-medium">Qty Received</th>
              <th className="px-4 py-2 text-center font-medium">Receipt %</th>
              <th className="px-4 py-2 text-right font-medium">Unit Price</th>
              <th className="px-4 py-2 text-right font-medium">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No lines</td></tr>}
            {order.lines.map(l => {
              const pct = l.qtyOrdered > 0 ? Math.round((l.qtyReceived / l.qtyOrdered) * 100) : 0;
              return (
                <tr key={l.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs text-muted-foreground">{l.lineNo}</td>
                  <td className="px-4 py-3 font-mono text-xs">{l.itemId}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{l.qtyOrdered}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{l.qtyReceived}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                        <div className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : pct > 0 ? "bg-amber-400" : "bg-muted-foreground/30"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-mono w-8 text-right">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(l.unitPrice)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-semibold">{fmt(lineTotal(l))}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-border bg-muted/30">
              <td colSpan={6} className="px-4 py-2 text-right text-xs font-medium">PO Total</td>
              <td className="px-4 py-2 text-right font-mono text-sm font-bold">{fmt(orderTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

## Task 4: Supplier Detail

**Files:**
- Modify: `apps/web/src/lib/api/mfg.ts` (add `getSupplier(id)`)
- Modify: `apps/web/app/(shell)/mfg/suppliers/page.tsx` (add row click)
- Modify: `apps/web/app/(shell)/procurement/suppliers/page.tsx` (add row click)
- Create: `apps/web/app/(shell)/mfg/suppliers/[id]/page.tsx`

### Step 4.1 — Add getSupplier to mfg.ts

Read `apps/web/src/lib/api/mfg.ts`. Find `listSuppliers()` and add `getSupplier(id)` right after it:

```typescript
export async function getSupplier(id: string): Promise<Supplier> {
  const r = await apiFetch(`${SVC}/suppliers/${id}`);
  if (!r.ok) throw new Error(`getSupplier failed: ${r.status}`);
  return normSupplier(await r.json());
}
```

### Step 4.2 — Add row click to both supplier list pages

Read both list pages and add `useRouter` + row `onClick` pointing to `/mfg/suppliers/` + supplier.id.

### Step 4.3 — Create Supplier Detail page

Create `apps/web/app/(shell)/mfg/suppliers/[id]/page.tsx`:

```typescript
"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getSupplier, listPurchaseOrders,
  type Supplier, type PurchaseOrder, type POStatus,
} from "@/lib/api/mfg";

const PO_STATUS_COLORS: Record<POStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-indigo-100 text-indigo-700",
  received: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getSupplier(id).then(setSupplier),
      listPurchaseOrders({ limit: 50 }).then(r =>
        setOrders(r.items.filter(po => po.supplierId === id))
      ),
    ]).finally(() => setLoading(false));
  }, [id]);

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });
  const totalPOValue = orders.reduce((s, po) => s + po.lines.reduce((ls, l) => ls + l.qtyOrdered * l.unitPrice, 0), 0);
  const openOrders = orders.filter(po => po.status !== "received" && po.status !== "cancelled").length;

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!supplier) return <div className="p-6 text-sm text-red-600">Supplier not found</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "MFG" }, { label: "Suppliers", href: "/mfg/suppliers" }, { label: supplier.name }]} />

      {/* Header */}
      <div className="rounded-lg border border-border bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold">{supplier.name}</h1>
            <span className="font-mono text-xs text-muted-foreground">{supplier.code}</span>
            {!supplier.active && <span className="px-2 py-0.5 rounded text-xs bg-zinc-100 text-zinc-500">Inactive</span>}
          </div>
          <div className="text-sm text-muted-foreground space-y-0.5">
            {supplier.contact && <div>{supplier.contact}</div>}
            {supplier.email && <div>{supplier.email}</div>}
            {supplier.phone && <div>{supplier.phone}</div>}
            <div className="text-xs">Lead time: {supplier.leadTimeDays} days</div>
          </div>
        </div>
        <button onClick={() => router.back()} className="text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded">← Back</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Total POs</div>
          <div className="text-2xl font-mono font-bold">{orders.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Open POs</div>
          <div className="text-2xl font-mono font-bold text-amber-600">{openOrders}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Total PO Value</div>
          <div className="text-2xl font-mono font-bold">{fmt(totalPOValue)}</div>
        </div>
      </div>

      {/* Purchase Orders */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 bg-muted/50 text-sm font-medium">Purchase Orders</div>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
            <tr>
              <th className="px-4 py-2 text-left font-medium">PO #</th>
              <th className="px-4 py-2 text-left font-medium">Order Date</th>
              <th className="px-4 py-2 text-left font-medium">Expected</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Lines</th>
              <th className="px-4 py-2 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No purchase orders</td></tr>}
            {orders.map(po => {
              const poVal = po.lines.reduce((s, l) => s + l.qtyOrdered * l.unitPrice, 0);
              return (
                <tr key={po.id} onClick={() => router.push(`/procurement/purchase-orders/${po.id}`)}
                  className="border-t border-border hover:bg-muted/20 cursor-pointer">
                  <td className="px-4 py-3 font-mono text-xs">{po.poNumber}</td>
                  <td className="px-4 py-3 text-xs">{po.orderDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs">{po.expectedDate?.slice(0, 10) ?? "—"}</td>
                  <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-xs ${PO_STATUS_COLORS[po.status as POStatus] ?? "bg-zinc-100 text-zinc-600"}`}>{po.status}</span></td>
                  <td className="px-4 py-3 text-right text-xs">{po.lines.length}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(poVal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```
