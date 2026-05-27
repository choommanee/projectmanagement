# Plan #24 — Sales Invoices, Vendor Scorecard, HR Training Records, MFG Item Costing

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the sales cycle with AR invoices, add vendor performance scorecard, employee training records, and a MFG item costing worksheet.

**Architecture:**
- Sales Invoices: new page in Sales Hub + proxy to sales-svc `/v1/invoices`; "Create Invoice" action on shipped SOs
- Vendor Scorecard: new Procurement page computing on-time delivery %, quality score from PO/GR data
- HR Training: new HR page + hr-svc proxy for training records (certifications, courses)
- MFG Costing: new MFG page computing BOM material cost + labor cost per work order

**Tech Stack:** Next.js 15, React 19, Tailwind 4, `@pmplatform/ui-kit`

---

## Task 1: Sales — AR Invoice Page

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Invoices to Sales nav)
- Modify: `apps/web/src/lib/api/sales.ts` (add invoice types + functions)
- Create: `apps/web/app/(shell)/sales/invoices/page.tsx`
- Create: `apps/web/app/api/sales/invoices/route.ts`
- Create: `apps/web/app/api/sales/invoices/[id]/route.ts`
- Modify: `apps/web/app/(shell)/sales/orders/page.tsx` (add "Create Invoice" action on shipped SOs)

### Step 1.1 — Read sales orders page and sales.ts first

Read `apps/web/app/(shell)/sales/orders/page.tsx` and `apps/web/src/lib/api/sales.ts` fully to understand current structure.

### Step 1.2 — Add Invoices to Sales Hub nav

Open `apps/web/src/lib/mock/apps.ts`. Find the `id: "sales"` app CRM group. Add after Sales Orders:

```typescript
{ id: "invoices", name: "Invoices", href: "/sales/invoices", icon: "tasks" },
```

### Step 1.3 — Add invoice types and functions to sales.ts

Append to `apps/web/src/lib/api/sales.ts`:

```typescript
export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

export interface SalesInvoice {
  id: string;
  code?: string;
  so_id?: string;
  customer_id: string;
  customer_name?: string;
  issue_date: string;
  due_date?: string;
  status: InvoiceStatus;
  subtotal?: number;
  tax?: number;
  total?: number;
  notes?: string;
  created_at?: string;
}

export async function listSalesInvoices(params?: { status?: string }): Promise<SalesInvoice[]> {
  const q = params?.status ? `?status=${params.status}` : "";
  const r = await fetch(`/api/sales/invoices${q}`);
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.invoices ?? [];
}

export async function createSalesInvoice(body: {
  so_id?: string;
  customer_id: string;
  issue_date: string;
  due_date?: string;
  notes?: string;
}): Promise<SalesInvoice> {
  const r = await fetch("/api/sales/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<void> {
  const r = await fetch(`/api/sales/invoices/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) throw new Error(await r.text());
}
```

### Step 1.4 — Create invoice proxy routes

Create `apps/web/app/api/sales/invoices/route.ts`:

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
  const r = await fetch(`${SALES_URL}/v1/invoices${url.search}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SALES_URL}/v1/invoices`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

Create `apps/web/app/api/sales/invoices/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SALES_URL = process.env.SALES_URL ?? "http://localhost:8094";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${SALES_URL}/v1/invoices/${id}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SALES_URL}/v1/invoices/${id}`, { method: "PATCH", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

### Step 1.5 — Create Sales Invoices page

Create `apps/web/app/(shell)/sales/invoices/page.tsx`:

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listSalesInvoices, createSalesInvoice, updateInvoiceStatus, listCustomers,
  type SalesInvoice, type InvoiceStatus, type Customer,
} from "@/lib/api/sales";

const STATUS_OPTS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

function statusTone(s: string): "neutral" | "info" | "success" | "danger" | "warning" {
  if (s === "draft") return "neutral";
  if (s === "sent") return "info";
  if (s === "paid") return "success";
  if (s === "overdue") return "danger";
  if (s === "cancelled") return "warning";
  return "neutral";
}

function fmt(n?: number) {
  return n != null ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n) : "—";
}

function NewInvoiceDialog({
  open, customers, onClose, onCreated,
}: { open: boolean; customers: Customer[]; onClose: () => void; onCreated: (inv: SalesInvoice) => void }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ customer_id: "", issue_date: today, due_date: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ customer_id: customers[0]?.id ?? "", issue_date: today, due_date: "", notes: "" });
      setError(null);
    }
  }, [open, customers, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer_id) { setError("Customer required"); return; }
    setLoading(true);
    try {
      const inv = await createSalesInvoice({
        customer_id: form.customer_id,
        issue_date: form.issue_date,
        due_date: form.due_date || undefined,
        notes: form.notes || undefined,
      });
      onCreated(inv);
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Invoice">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[360px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Customer *</span>
          <select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent">
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Issue Date</span>
          <Input type="date" value={form.issue_date} onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Due Date</span>
          <Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Notes</span>
          <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Reference, terms…" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create Invoice"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function SalesInvoicesPage() {
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([listSalesInvoices(statusFilter ? { status: statusFilter } : undefined), listCustomers()])
      .then(([ir, cr]) => {
        setInvoices(ir.status === "fulfilled" ? ir.value : []);
        setCustomers(cr.status === "fulfilled" ? cr.value : []);
      })
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function markAs(id: string, status: InvoiceStatus) {
    setProcessing(id);
    try { await updateInvoiceStatus(id, status); load(); } finally { setProcessing(null); }
  }

  const totalOutstanding = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((s, i) => s + (i.total ?? 0), 0);

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Sales", href: "/sales/home" }, { label: "Invoices" }]} />
      <CommandBar title="Invoices" actions={[{ id: "new", label: "New Invoice", icon: "plus", onClick: () => setNewOpen(true) }]} />

      <div className="flex items-center gap-3 flex-wrap">
        {STATUS_OPTS.map((opt) => (
          <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
            className={`rounded px-3 py-1 text-sm font-medium transition-colors ${statusFilter === opt.value ? "bg-accent text-white" : "bg-surface-2 text-ink hover:bg-surface-3"}`}>
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-sm text-ink-muted">
          Outstanding: <span className="font-mono font-semibold text-ink">{fmt(totalOutstanding)}</span>
        </span>
      </div>

      {loading ? <p className="text-sm text-ink-muted">Loading…</p> : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Code</th>
                <th className="px-4 py-2 text-left font-medium">Customer</th>
                <th className="px-4 py-2 text-left font-medium">Issued</th>
                <th className="px-4 py-2 text-left font-medium">Due</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoices.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-muted">No invoices found.</td></tr>
              ) : invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-mono text-xs">{inv.code ?? inv.id.slice(0, 8)}</td>
                  <td className="px-4 py-2 font-medium">{inv.customer_name ?? inv.customer_id}</td>
                  <td className="px-4 py-2 text-ink-muted">{new Date(inv.issue_date).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-ink-muted">{inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{fmt(inv.total)}</td>
                  <td className="px-4 py-2"><Tag tone={statusTone(inv.status)} size="sm">{inv.status}</Tag></td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      {inv.status === "draft" && (
                        <Button size="sm" variant="ghost" onClick={() => markAs(inv.id, "sent")} disabled={processing === inv.id}>Send</Button>
                      )}
                      {(inv.status === "sent" || inv.status === "overdue") && (
                        <Button size="sm" variant="ghost" onClick={() => markAs(inv.id, "paid")} disabled={processing === inv.id}>Mark Paid</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewInvoiceDialog open={newOpen} customers={customers} onClose={() => setNewOpen(false)}
        onCreated={(inv) => { setInvoices((p) => [inv, ...p]); setNewOpen(false); }} />
    </div>
  );
}
```

### Step 1.6 — Commit

```bash
git add "apps/web/app/(shell)/sales/invoices/" "apps/web/app/api/sales/invoices/" "apps/web/src/lib/api/sales.ts" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan24): Sales AR Invoices — create, send, mark paid"
```

---

## Task 2: Procurement — Vendor Scorecard

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Vendor Scorecard to Procurement nav)
- Create: `apps/web/app/(shell)/procurement/vendor-scorecard/page.tsx`

### Step 2.1 — Add Vendor Scorecard to Procurement nav

Open `apps/web/src/lib/mock/apps.ts`. Find the `id: "procurement"` app's `p2` Vendors group. Add:

```typescript
{ id: "vendor-scorecard", name: "Vendor Scorecard", href: "/procurement/vendor-scorecard", icon: "quality" },
```

### Step 2.2 — Create Vendor Scorecard page

The scorecard is computed client-side from PO + supplier data. Read `apps/web/src/lib/api/mfg.ts` first to understand `Supplier` and `PurchaseOrder` types.

Create `apps/web/app/(shell)/procurement/vendor-scorecard/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";
import { listSuppliers, listPurchaseOrders, type Supplier, type PurchaseOrder } from "@/lib/api/mfg";

interface SupplierScore {
  supplier: Supplier;
  totalPOs: number;
  receivedPOs: number;
  onTimeRate: number;
  totalValue: number;
  score: "A" | "B" | "C" | "D";
}

function grade(rate: number): "A" | "B" | "C" | "D" {
  if (rate >= 0.9) return "A";
  if (rate >= 0.75) return "B";
  if (rate >= 0.6) return "C";
  return "D";
}

function gradeTone(g: string): "success" | "info" | "warning" | "danger" {
  if (g === "A") return "success";
  if (g === "B") return "info";
  if (g === "C") return "warning";
  return "danger";
}

function pct(n: number) { return `${Math.round(n * 100)}%`; }
function fmt(n: number) { return new Intl.NumberFormat("en-US", { minimumFractionDigits: 0 }).format(n); }

export default function VendorScorecardPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"score" | "totalPOs" | "totalValue">("score");

  useEffect(() => {
    Promise.allSettled([listSuppliers(), listPurchaseOrders()])
      .then(([sr, pr]) => {
        setSuppliers(sr.status === "fulfilled" ? sr.value : []);
        const items = pr.status === "fulfilled"
          ? (Array.isArray(pr.value) ? pr.value : (pr.value as { items: PurchaseOrder[] }).items ?? [])
          : [];
        setPOs(items);
      })
      .finally(() => setLoading(false));
  }, []);

  const scores = useMemo((): SupplierScore[] => {
    return suppliers.map((sup) => {
      const supPOs = pos.filter((p) => p.supplierId === sup.id || p.supplier_id === sup.id);
      const received = supPOs.filter((p) => p.status === "received");
      const totalValue = supPOs.reduce((s, p) => s + (p.totalAmount ?? p.total_amount ?? 0), 0);
      const onTimeRate = supPOs.length > 0 ? received.length / supPOs.length : 0;
      return {
        supplier: sup,
        totalPOs: supPOs.length,
        receivedPOs: received.length,
        onTimeRate,
        totalValue,
        score: grade(onTimeRate),
      };
    }).filter((s) => s.totalPOs > 0);
  }, [suppliers, pos]);

  const sorted = useMemo(() => {
    return [...scores].sort((a, b) => {
      if (sortBy === "totalPOs") return b.totalPOs - a.totalPOs;
      if (sortBy === "totalValue") return b.totalValue - a.totalValue;
      const gradeOrder = { A: 0, B: 1, C: 2, D: 3 };
      return gradeOrder[a.score] - gradeOrder[b.score];
    });
  }, [scores, sortBy]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: "Procurement", href: "/procurement/home" }, { label: "Vendor Scorecard" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Vendor Scorecard</h1>
        <div className="flex items-center gap-2 text-sm text-ink-muted">
          <span>Sort by:</span>
          {(["score", "totalPOs", "totalValue"] as const).map((s) => (
            <button key={s} onClick={() => setSortBy(s)}
              className={`rounded px-2 py-1 text-xs font-medium transition-colors ${sortBy === s ? "bg-accent text-white" : "bg-surface-2 hover:bg-surface-3"}`}>
              {s === "score" ? "Grade" : s === "totalPOs" ? "# POs" : "Value"}
            </button>
          ))}
        </div>
      </div>

      {/* Grade legend */}
      <div className="flex gap-3 text-xs text-ink-muted">
        {[{ g: "A", desc: "≥ 90% on-time" }, { g: "B", desc: "75–89%" }, { g: "C", desc: "60–74%" }, { g: "D", desc: "< 60%" }].map(({ g, desc }) => (
          <div key={g} className="flex items-center gap-1.5">
            <Tag tone={gradeTone(g)} size="sm">{g}</Tag>
            <span>{desc}</span>
          </div>
        ))}
      </div>

      {loading ? <p className="text-sm text-ink-muted">Loading…</p> : sorted.length === 0 ? (
        <p className="text-sm text-ink-muted">No supplier data with purchase orders.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Supplier</th>
                <th className="px-4 py-2 text-right font-medium">Total POs</th>
                <th className="px-4 py-2 text-right font-medium">Received</th>
                <th className="px-4 py-2 text-right font-medium">On-Time Rate</th>
                <th className="px-4 py-2 text-right font-medium">Total Value</th>
                <th className="px-4 py-2 text-center font-medium">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sorted.map(({ supplier, totalPOs, receivedPOs, onTimeRate, totalValue, score }) => (
                <tr key={supplier.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-medium">{supplier.name}</td>
                  <td className="px-4 py-2 text-right font-mono">{totalPOs}</td>
                  <td className="px-4 py-2 text-right font-mono">{receivedPOs}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-1.5 rounded-full bg-surface-3">
                        <div className={`h-1.5 rounded-full ${onTimeRate >= 0.9 ? "bg-success" : onTimeRate >= 0.75 ? "bg-info" : onTimeRate >= 0.6 ? "bg-warning" : "bg-danger"}`}
                          style={{ width: pct(onTimeRate) }} />
                      </div>
                      <span className="font-mono text-xs w-10 text-right">{pct(onTimeRate)}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(totalValue)}</td>
                  <td className="px-4 py-2 text-center">
                    <Tag tone={gradeTone(score)} size="sm">{score}</Tag>
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

### Step 2.3 — Commit

```bash
git add "apps/web/app/(shell)/procurement/vendor-scorecard/" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan24): Procurement Vendor Scorecard — on-time rate + grade per supplier"
```

---

## Task 3: HR — Training Records

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Training to HR nav)
- Modify: `apps/web/src/lib/api/hr.ts` (add training types + functions)
- Create: `apps/web/app/(shell)/hr/training/page.tsx`
- Create: `apps/web/app/api/hr/training/route.ts`
- Create: `apps/web/app/api/hr/training/[id]/route.ts`

### Step 3.1 — Add Training to HR nav

Open `apps/web/src/lib/mock/apps.ts`. Find the HR Hub's `org` area. Add a new group or subarea:

Find the area that has Departments/Positions/Employees and add:

```typescript
{ id: "training", name: "Training Records", href: "/hr/training", icon: "knowledge" },
```

Add it in the org group's subareas after Employees.

### Step 3.2 — Add training types to hr.ts

Read `apps/web/src/lib/api/hr.ts` first, then append:

```typescript
export type TrainingStatus = "enrolled" | "in_progress" | "completed" | "expired";

export interface TrainingRecord {
  id: string;
  employee_id: string;
  employee_name?: string;
  course_name: string;
  provider?: string;
  started_at?: string;
  completed_at?: string;
  expiry_date?: string;
  status: TrainingStatus;
  certificate_no?: string;
  notes?: string;
}

export async function listTrainingRecords(params?: { employee_id?: string; status?: string }): Promise<TrainingRecord[]> {
  const q = new URLSearchParams();
  if (params?.employee_id) q.set("employee_id", params.employee_id);
  if (params?.status) q.set("status", params.status);
  const r = await fetch(`/api/hr/training?${q}`);
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.records ?? [];
}

export async function createTrainingRecord(body: Omit<TrainingRecord, "id" | "employee_name">): Promise<TrainingRecord> {
  const r = await fetch("/api/hr/training", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateTrainingStatus(id: string, status: TrainingStatus, certificate_no?: string): Promise<void> {
  const r = await fetch(`/api/hr/training/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, certificate_no }),
  });
  if (!r.ok) throw new Error(await r.text());
}
```

### Step 3.3 — Create training proxy routes

Create `apps/web/app/api/hr/training/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const HR_URL = process.env.HR_URL ?? "http://localhost:8096";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${HR_URL}/v1/training${url.search}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${HR_URL}/v1/training`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

Create `apps/web/app/api/hr/training/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const HR_URL = process.env.HR_URL ?? "http://localhost:8096";

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
  const r = await fetch(`${HR_URL}/v1/training/${id}`, { method: "PATCH", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

### Step 3.4 — Create Training Records page

Create `apps/web/app/(shell)/hr/training/page.tsx`:

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listTrainingRecords, createTrainingRecord, listEmployees,
  type TrainingRecord, type TrainingStatus, type Employee,
} from "@/lib/api/hr";

const STATUS_OPTS = [
  { value: "", label: "All" },
  { value: "enrolled", label: "Enrolled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "expired", label: "Expired" },
];

function statusTone(s: string): "neutral" | "info" | "success" | "danger" | "warning" {
  if (s === "enrolled") return "neutral";
  if (s === "in_progress") return "info";
  if (s === "completed") return "success";
  if (s === "expired") return "danger";
  return "neutral";
}

function NewTrainingDialog({
  open, employees, onClose, onCreated,
}: { open: boolean; employees: Employee[]; onClose: () => void; onCreated: (r: TrainingRecord) => void }) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ employee_id: "", course_name: "", provider: "", started_at: today, expiry_date: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ employee_id: employees[0]?.id ?? "", course_name: "", provider: "", started_at: today, expiry_date: "", notes: "" });
      setError(null);
    }
  }, [open, employees, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.employee_id || !form.course_name) { setError("Employee and course name required"); return; }
    setLoading(true);
    try {
      const rec = await createTrainingRecord({
        employee_id: form.employee_id,
        course_name: form.course_name,
        provider: form.provider || undefined,
        started_at: form.started_at || undefined,
        expiry_date: form.expiry_date || undefined,
        notes: form.notes || undefined,
        status: "enrolled",
      });
      onCreated(rec);
    } catch (err) { setError(String(err)); } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Training Record">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[360px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Employee *</span>
          <select value={form.employee_id} onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent">
            {employees.map((emp) => <option key={emp.id} value={emp.id}>{emp.full_name ?? emp.id}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Course Name *</span>
          <Input value={form.course_name} onChange={(e) => setForm((f) => ({ ...f, course_name: e.target.value }))} placeholder="ISO 9001 Internal Auditor…" required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Provider</span>
          <Input value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} placeholder="TÜV, SGS, internal…" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Start Date</span>
          <Input type="date" value={form.started_at} onChange={(e) => setForm((f) => ({ ...f, started_at: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Expiry Date</span>
          <Input type="date" value={form.expiry_date} onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Saving…" : "Add Record"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function HRTrainingPage() {
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      listTrainingRecords(statusFilter ? { status: statusFilter } : undefined),
      listEmployees(),
    ]).then(([rr, er]) => {
      setRecords(rr.status === "fulfilled" ? rr.value : []);
      setEmployees(er.status === "fulfilled" ? (Array.isArray(er.value) ? er.value : (er.value as { items: Employee[] }).items ?? []) : []);
    }).finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const expiringSoon = records.filter((r) => {
    if (!r.expiry_date) return false;
    const days = (new Date(r.expiry_date).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 30;
  }).length;

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "HR", href: "/hr/home" }, { label: "Training Records" }]} />
      <CommandBar title="Training Records" actions={[{ id: "new", label: "Add Record", icon: "plus", onClick: () => setNewOpen(true) }]} />

      {expiringSoon > 0 && (
        <div className="rounded border border-warning/30 bg-warning/5 px-4 py-2 text-sm text-warning">
          ⚠ {expiringSoon} certification{expiringSoon > 1 ? "s" : ""} expiring within 30 days
        </div>
      )}

      <div className="flex gap-2">
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
                <th className="px-4 py-2 text-left font-medium">Employee</th>
                <th className="px-4 py-2 text-left font-medium">Course</th>
                <th className="px-4 py-2 text-left font-medium">Provider</th>
                <th className="px-4 py-2 text-left font-medium">Started</th>
                <th className="px-4 py-2 text-left font-medium">Expires</th>
                <th className="px-4 py-2 text-left font-medium">Cert #</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {records.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-muted">No training records found.</td></tr>
              ) : records.map((rec) => {
                const expiring = rec.expiry_date && ((new Date(rec.expiry_date).getTime() - Date.now()) / 86400000) <= 30;
                return (
                  <tr key={rec.id} className={`hover:bg-surface-2/50 ${expiring ? "bg-warning/5" : ""}`}>
                    <td className="px-4 py-2 font-medium">{rec.employee_name ?? rec.employee_id}</td>
                    <td className="px-4 py-2">{rec.course_name}</td>
                    <td className="px-4 py-2 text-ink-muted">{rec.provider ?? "—"}</td>
                    <td className="px-4 py-2 text-ink-muted">{rec.started_at ? new Date(rec.started_at).toLocaleDateString() : "—"}</td>
                    <td className={`px-4 py-2 ${expiring ? "text-warning font-semibold" : "text-ink-muted"}`}>
                      {rec.expiry_date ? new Date(rec.expiry_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-muted">{rec.certificate_no ?? "—"}</td>
                    <td className="px-4 py-2"><Tag tone={statusTone(rec.status)} size="sm">{rec.status}</Tag></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NewTrainingDialog open={newOpen} employees={employees} onClose={() => setNewOpen(false)}
        onCreated={(rec) => { setRecords((p) => [rec, ...p]); setNewOpen(false); }} />
    </div>
  );
}
```

### Step 3.5 — Commit

```bash
git add "apps/web/app/(shell)/hr/training/" "apps/web/app/api/hr/training/" "apps/web/src/lib/api/hr.ts" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan24): HR Training Records — enrollment, certification expiry alerts"
```

---

## Task 4: MFG — Item Costing Worksheet

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Costing to MFG nav)
- Create: `apps/web/app/(shell)/mfg/costing/page.tsx`

### Step 4.1 — Add Costing to MFG nav

Open `apps/web/src/lib/mock/apps.ts`. Find the MFG app. Add to the items/BOM area:

```typescript
{ id: "costing", name: "Item Costing", href: "/mfg/costing", icon: "dashboard" },
```

Add it in the same group as BOM or Items.

### Step 4.2 — Create Item Costing page

Read `apps/web/src/lib/api/mfg.ts` first to understand `Item`, `BomLine`, and related types.

Create `apps/web/app/(shell)/mfg/costing/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";
import { listItems, getBom, type Item, type BomLine } from "@/lib/api/mfg";

interface ItemCost {
  item: Item;
  materialCost: number;
  bomLineCount: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export default function ItemCostingPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [bomMap, setBomMap] = useState<Map<string, BomLine[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Item | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    listItems()
      .then(async (result) => {
        const itemList = Array.isArray(result) ? result : (result as { items: Item[] }).items ?? [];
        setItems(itemList);

        // Load BOMs for items that have type "manufactured" or "semi"
        const mfgItems = itemList.filter((i) => i.type === "manufactured" || i.type === "semi" || i.item_type === "manufactured");
        const bomResults = await Promise.allSettled(mfgItems.map((i) => getBom(i.id)));
        const map = new Map<string, BomLine[]>();
        bomResults.forEach((res, idx) => {
          if (res.status === "fulfilled" && res.value) {
            const lines = Array.isArray(res.value) ? res.value : res.value.lines ?? [];
            map.set(mfgItems[idx].id, lines);
          }
        });
        setBomMap(map);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const costs = useMemo((): ItemCost[] => {
    return items.map((item) => {
      const lines = bomMap.get(item.id) ?? [];
      const materialCost = lines.reduce((s, l) => {
        const unitCost = l.unit_cost ?? l.unitCost ?? 0;
        const qty = l.qty ?? l.quantity ?? 1;
        return s + unitCost * qty;
      }, 0);
      return { item, materialCost, bomLineCount: lines.length };
    }).filter((c) => c.bomLineCount > 0 || c.item.standard_cost != null);
  }, [items, bomMap]);

  const filtered = useMemo(() =>
    costs.filter((c) => !search || c.item.name?.toLowerCase().includes(search.toLowerCase()) || c.item.code?.toLowerCase().includes(search.toLowerCase())),
    [costs, search]);

  const selectedLines = selected ? (bomMap.get(selected.id) ?? []) : [];

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "MFG", href: "/mfg/home" }, { label: "Item Costing" }]} />
      <h1 className="text-xl font-semibold">Item Costing Worksheet</h1>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search items…"
        className="max-w-xs rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
      />

      {loading ? <p className="text-sm text-ink-muted">Loading items and BOMs…</p> : (
        <div className="flex gap-4">
          {/* Item list */}
          <div className="flex-1 overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-ink-muted">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Code</th>
                  <th className="px-4 py-2 text-left font-medium">Name</th>
                  <th className="px-4 py-2 text-right font-medium">BOM Lines</th>
                  <th className="px-4 py-2 text-right font-medium">Material Cost</th>
                  <th className="px-4 py-2 text-right font-medium">Standard Cost</th>
                  <th className="px-4 py-2 text-right font-medium">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-muted">No manufactured items with BOM data.</td></tr>
                ) : filtered.map(({ item, materialCost, bomLineCount }) => {
                  const stdCost = item.standard_cost ?? item.standardCost ?? 0;
                  const variance = stdCost - materialCost;
                  return (
                    <tr key={item.id}
                      onClick={() => setSelected(selected?.id === item.id ? null : item)}
                      className={`cursor-pointer hover:bg-surface-2/50 ${selected?.id === item.id ? "bg-accent/5 border-l-2 border-l-accent" : ""}`}>
                      <td className="px-4 py-2 font-mono text-xs">{item.code}</td>
                      <td className="px-4 py-2 font-medium">{item.name}</td>
                      <td className="px-4 py-2 text-right font-mono">{bomLineCount}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmt(materialCost)}</td>
                      <td className="px-4 py-2 text-right font-mono">{fmt(stdCost)}</td>
                      <td className={`px-4 py-2 text-right font-mono font-semibold ${variance >= 0 ? "text-success" : "text-danger"}`}>
                        {variance >= 0 ? "+" : ""}{fmt(variance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* BOM detail panel */}
          {selected && (
            <div className="w-72 flex-shrink-0 rounded-lg border border-line bg-surface p-4">
              <h3 className="font-semibold text-sm mb-3">{selected.name} — BOM</h3>
              {selectedLines.length === 0 ? (
                <p className="text-xs text-ink-muted">No BOM lines.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {selectedLines.map((l, i) => (
                    <div key={i} className="flex flex-col gap-0.5 rounded border border-line bg-surface-2 px-3 py-2 text-xs">
                      <span className="font-medium">{l.item_name ?? l.itemName ?? l.item_id ?? l.itemId}</span>
                      <div className="flex justify-between text-ink-muted">
                        <span>Qty: {l.qty ?? l.quantity ?? 1} {l.uom ?? l.unit ?? ""}</span>
                        <span>Unit cost: {fmt(l.unit_cost ?? l.unitCost ?? 0)}</span>
                      </div>
                      <div className="text-right font-mono font-semibold">
                        = {fmt((l.unit_cost ?? l.unitCost ?? 0) * (l.qty ?? l.quantity ?? 1))}
                      </div>
                    </div>
                  ))}
                  <div className="border-t border-line pt-2 flex justify-between text-sm font-semibold">
                    <span>Total Material</span>
                    <span className="font-mono">{fmt(selectedLines.reduce((s, l) => s + (l.unit_cost ?? l.unitCost ?? 0) * (l.qty ?? l.quantity ?? 1), 0))}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 4.3 — Commit

```bash
git add "apps/web/app/(shell)/mfg/costing/" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan24): MFG Item Costing worksheet — BOM material cost vs standard cost variance"
```

---

## Task 5: Typecheck

Run:
```bash
cd /Users/sakdachoommanee/Documents/projectmanagment
pnpm --filter web typecheck 2>&1 | tail -20
```

Fix all type errors. Key things to verify:
- `Employee.full_name` — check the actual field name in hr.ts (might be `fullName` camelCase)
- `Item.standard_cost` vs `standardCost` — check mfg.ts
- `BomLine` fields: `qty`, `unit_cost`, `item_id`, `item_name` — verify actual names
- `PurchaseOrder` fields: `supplierId` vs `supplier_id` — use optional chaining
- `listEmployees()` return type — check if it returns array or `{ items, total }`
