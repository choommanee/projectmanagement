# Plan #23 — Goods Receipt, Quote→Order Conversion, Payroll Run, MFG Shift Report

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the procure-to-pay flow (Goods Receipt against PO), add Quote→SO one-click conversion, HR Payroll Run batch UI, and a MFG Shift Report page.

**Architecture:**
- Goods Receipt: new page `procurement/goods-receipts/` + proxy to mfg-svc PO receive endpoint
- Quote conversion: "Convert to Order" button on accepted quotations page calls sales-svc
- Payroll Run: new HR page for batch payroll processing
- Shift Report: new MFG page showing daily production summary
- All proxy routes follow the standard `proxyHeaders()` negative-guard pattern

**Tech Stack:** Next.js 15, React 19, Tailwind 4, `@pmplatform/ui-kit`

---

## Task 1: Procurement — Goods Receipt Page

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Goods Receipts to Procurement nav)
- Modify: `apps/web/src/lib/api/mfg.ts` (add GR functions)
- Create: `apps/web/app/(shell)/procurement/goods-receipts/page.tsx`
- Create: `apps/web/app/api/mfg/purchase-orders/[id]/receive/route.ts`

### Step 1.1 — Add Goods Receipts to Procurement nav

Open `apps/web/src/lib/mock/apps.ts`. Find the `id: "procurement"` app's purchasing area. Add a new subarea:

```typescript
{ id: "goods-receipts", name: "Goods Receipts", href: "/procurement/goods-receipts", icon: "warehouse" },
```

Add it after the Purchase Orders subarea inside the `p1` Orders group.

### Step 1.2 — Add GR functions to mfg.ts

Open `apps/web/src/lib/api/mfg.ts`. Add after the existing PO functions:

```typescript
export interface GoodsReceipt {
  id: string;
  po_id: string;
  po_code?: string;
  supplier_name?: string;
  received_at: string;
  lines: Array<{ item_id: string; item_name?: string; qty_ordered: number; qty_received: number }>;
  status: "draft" | "confirmed";
  notes?: string;
}

export async function listGoodsReceipts(): Promise<GoodsReceipt[]> {
  const r = await fetch("/api/mfg/goods-receipts");
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.receipts ?? [];
}

export async function receivePO(poId: string, body: { lines: Array<{ line_id: string; qty_received: number }>; notes?: string }): Promise<void> {
  const r = await fetch(`/api/mfg/purchase-orders/${poId}/receive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
}
```

### Step 1.3 — Create receive proxy route

Create `apps/web/app/api/mfg/purchase-orders/[id]/receive/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const MFG_URL = process.env.MFG_URL ?? "http://localhost:8085";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${MFG_URL}/v1/purchase-orders/${id}/receive`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

### Step 1.4 — Create Goods Receipts page

Create `apps/web/app/(shell)/procurement/goods-receipts/page.tsx`:

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listPurchaseOrders, getPurchaseOrder, receivePO,
  type PurchaseOrder, type POLine,
} from "@/lib/api/mfg";

function ReceivePODialog({
  po, open, onClose, onDone,
}: { po: PurchaseOrder | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [lines, setLines] = useState<Array<{ line_id: string; qty_ordered: number; qty_received: number; item_name?: string }>>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && po) {
      getPurchaseOrder(po.id).then((fullPO) => {
        setLines((fullPO.lines ?? []).map((l: POLine) => ({
          line_id: l.id,
          qty_ordered: l.qty_ordered,
          qty_received: l.qty_ordered,
          item_name: l.item_name,
        })));
      });
      setNotes("");
      setError(null);
    }
  }, [open, po]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!po) return;
    setLoading(true);
    try {
      await receivePO(po.id, {
        lines: lines.map((l) => ({ line_id: l.line_id, qty_received: l.qty_received })),
        notes: notes || undefined,
      });
      onDone();
    } catch (err) {
      setError(String(err));
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Receive PO — ${po?.code ?? po?.id?.slice(0, 8)}`}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-4 min-w-[400px]">
        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Lines to Receive</p>
          {lines.map((l, i) => (
            <div key={l.line_id} className="flex items-center gap-3 rounded border border-line bg-surface-2 px-3 py-2">
              <span className="flex-1 text-sm">{l.item_name ?? l.line_id}</span>
              <span className="text-xs text-ink-muted">Ordered: {l.qty_ordered}</span>
              <input
                type="number"
                min={0}
                max={l.qty_ordered}
                value={l.qty_received}
                onChange={(e) => setLines((prev) => prev.map((r, j) => j === i ? { ...r, qty_received: Number(e.target.value) } : r))}
                className="w-20 rounded border border-line bg-surface px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          ))}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            placeholder="Delivery note, batch reference…"
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading || lines.length === 0}>
            {loading ? "Receiving…" : "Confirm Receipt"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function GoodsReceiptsPage() {
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listPurchaseOrders({ status: "approved" })
      .then(setPOs)
      .catch(() => setPOs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openReceive(po: PurchaseOrder) {
    setReceivePO(po);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Procurement", href: "/procurement/home" }, { label: "Goods Receipts" }]} />
      <CommandBar title="Goods Receipts" actions={[]} />

      <div className="rounded border border-line bg-surface-2 px-4 py-2 text-sm text-ink-muted">
        Showing approved Purchase Orders ready for goods receipt.
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">PO Code</th>
                <th className="px-4 py-2 text-left font-medium">Supplier</th>
                <th className="px-4 py-2 text-left font-medium">Order Date</th>
                <th className="px-4 py-2 text-left font-medium">Expected</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pos.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-muted">No approved POs awaiting receipt.</td></tr>
              ) : pos.map((po) => (
                <tr key={po.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-mono text-xs">{po.code ?? po.id.slice(0, 8)}</td>
                  <td className="px-4 py-2 font-medium">{po.supplier_name ?? po.supplier_id}</td>
                  <td className="px-4 py-2 text-ink-muted">{po.order_date ? new Date(po.order_date).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2 text-ink-muted">{po.expected_date ? new Date(po.expected_date).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2"><Tag tone="accent" size="sm">{po.status}</Tag></td>
                  <td className="px-4 py-2">
                    <Button size="sm" variant="primary" onClick={() => openReceive(po)}>Receive</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReceivePODialog
        po={receivePO}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onDone={() => { setDialogOpen(false); load(); }}
      />
    </div>
  );
}
```

**Note:** `listPurchaseOrders` in mfg.ts must accept an optional `{ status?: string }` param and pass it as a query param. Check the function — if it doesn't, add `status` to its params and URL.

### Step 1.5 — Commit

```bash
git add "apps/web/app/(shell)/procurement/goods-receipts/" "apps/web/app/api/mfg/purchase-orders/[id]/receive/" "apps/web/src/lib/api/mfg.ts" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan23): Procurement Goods Receipt — receive approved POs with line qty"
```

---

## Task 2: Sales — Convert Quote to Sales Order

**Files:**
- Modify: `apps/web/app/(shell)/sales/quotations/page.tsx`
- Modify: `apps/web/src/lib/api/sales.ts`
- Create: `apps/web/app/api/sales/quotations/[id]/convert/route.ts`

### Step 2.1 — Add convertQuoteToOrder to sales.ts

Read `apps/web/src/lib/api/sales.ts` first, then add:

```typescript
export async function convertQuoteToOrder(quoteId: string): Promise<SalesOrder> {
  const r = await fetch(`/api/sales/quotations/${quoteId}/convert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
```

### Step 2.2 — Create convert proxy route

Create `apps/web/app/api/sales/quotations/[id]/convert/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SALES_URL = process.env.SALES_URL ?? "http://localhost:8094";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SALES_URL}/v1/quotations/${id}/convert`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

### Step 2.3 — Add "Convert to Order" button on quotations page

Read `apps/web/app/(shell)/sales/quotations/page.tsx` fully, then add:

1. Import `convertQuoteToOrder` from `@/lib/api/sales`
2. Import `useRouter` from `next/navigation`
3. Add an async `handleConvert(id: string)` function in the component:

```typescript
const router = useRouter();

async function handleConvert(id: string) {
  setProcessing(id);
  try {
    const so = await convertQuoteToOrder(id);
    router.push(`/sales/orders`);
  } catch (err) {
    // show inline error — add a brief error toast state
    alert(`Failed to convert: ${err}`);
  } finally { setProcessing(null); }
}
```

4. In the actions column, when `q.status === "accepted"`, add a "Convert to SO" button alongside any existing actions:

```typescript
{q.status === "accepted" && (
  <Button size="sm" variant="primary" onClick={() => handleConvert(q.id)} disabled={processing === q.id}>
    Convert to SO
  </Button>
)}
```

### Step 2.4 — Commit

```bash
git add "apps/web/app/(shell)/sales/quotations/page.tsx" "apps/web/app/api/sales/quotations/[id]/convert/" "apps/web/src/lib/api/sales.ts"
git commit -m "feat(plan23): Quote → Sales Order conversion button"
```

---

## Task 3: HR — Payroll Run Page

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Payroll Run to HR nav)
- Modify: `apps/web/src/lib/api/hr.ts` (add payroll run functions)
- Create: `apps/web/app/(shell)/hr/payroll-run/page.tsx`
- Create: `apps/web/app/api/hr/payroll-runs/route.ts`

### Step 3.1 — Add Payroll Run to HR nav

Open `apps/web/src/lib/mock/apps.ts`. Find the `payroll-area` in the HR hub. Add a new subarea:

```typescript
{ id: "payroll-run", name: "Payroll Run", href: "/hr/payroll-run", icon: "tasks" },
```

Add it BEFORE the existing "Payslips" subarea.

### Step 3.2 — Add payroll run functions to hr.ts

Open `apps/web/src/lib/api/hr.ts`. Add:

```typescript
export interface PayrollRun {
  id: string;
  period_start: string;
  period_end: string;
  status: "draft" | "processing" | "completed" | "cancelled";
  total_employees: number;
  total_net_pay: number;
  created_at: string;
  completed_at?: string;
}

export async function listPayrollRuns(): Promise<PayrollRun[]> {
  const r = await fetch("/api/hr/payroll-runs");
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.runs ?? [];
}

export async function createPayrollRun(body: { period_start: string; period_end: string }): Promise<PayrollRun> {
  const r = await fetch("/api/hr/payroll-runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
```

### Step 3.3 — Create payroll runs proxy route

Create `apps/web/app/api/hr/payroll-runs/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const HR_URL = process.env.HR_URL ?? "http://localhost:8096";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function GET() {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${HR_URL}/v1/payroll-runs`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${HR_URL}/v1/payroll-runs`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

### Step 3.4 — Create Payroll Run page

Create `apps/web/app/(shell)/hr/payroll-run/page.tsx`:

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import { listPayrollRuns, createPayrollRun, type PayrollRun } from "@/lib/api/hr";

function statusTone(s: string): "neutral" | "info" | "success" | "danger" {
  if (s === "draft") return "neutral";
  if (s === "processing") return "info";
  if (s === "completed") return "success";
  if (s === "cancelled") return "danger";
  return "neutral";
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n);
}

function NewRunDialog({
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (run: PayrollRun) => void }) {
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = today.slice(0, 8) + "01";
  const [form, setForm] = useState({ period_start: firstOfMonth, period_end: today });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setForm({ period_start: firstOfMonth, period_end: today }); setError(null); }
  }, [open, firstOfMonth, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const run = await createPayrollRun(form);
      onCreated(run);
    } catch (err) {
      setError(String(err));
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Payroll Run">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Period Start</span>
          <Input type="date" value={form.period_start} onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Period End</span>
          <Input type="date" value={form.period_end} onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))} required />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Start Payroll Run"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function PayrollRunPage() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listPayrollRuns().then(setRuns).catch(() => setRuns([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "HR", href: "/hr/home" }, { label: "Payroll Run" }]} />
      <CommandBar title="Payroll Runs" actions={[{
        id: "new", label: "New Run", icon: "plus", onClick: () => setNewOpen(true),
      }]} />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Employees</th>
                <th className="px-4 py-2 text-right font-medium">Total Net Pay</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Created</th>
                <th className="px-4 py-2 text-left font-medium">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-muted">No payroll runs. Click "New Run" to start one.</td></tr>
              ) : runs.map((run) => (
                <tr key={run.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-medium">
                    {run.period_start?.slice(0, 10)} → {run.period_end?.slice(0, 10)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{run.total_employees ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{fmt(run.total_net_pay ?? 0)}</td>
                  <td className="px-4 py-2">
                    <Tag tone={statusTone(run.status)} size="sm">{run.status}</Tag>
                  </td>
                  <td className="px-4 py-2 text-ink-muted">{new Date(run.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-ink-muted">{run.completed_at ? new Date(run.completed_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewRunDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(run) => { setRuns((prev) => [run, ...prev]); setNewOpen(false); }}
      />
    </div>
  );
}
```

### Step 3.5 — Commit

```bash
git add "apps/web/app/(shell)/hr/payroll-run/" "apps/web/app/api/hr/payroll-runs/" "apps/web/src/lib/api/hr.ts" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan23): HR Payroll Run — create run, view history"
```

---

## Task 4: MFG — Shift Report Page

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Shift Report to MFG nav)
- Create: `apps/web/app/(shell)/mfg/shift-report/page.tsx`

### Step 4.1 — Add Shift Report to MFG nav

Open `apps/web/src/lib/mock/apps.ts`. Find the MFG app's production area (or reporting area). Add:

```typescript
{ id: "shift-report", name: "Shift Report", href: "/mfg/shift-report", icon: "dashboard" },
```

Add it after the OEE Dashboard entry.

### Step 4.2 — Create Shift Report page

The shift report is computed client-side from real work order and inventory data.

Create `apps/web/app/(shell)/mfg/shift-report/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Tag } from "@pmplatform/ui-kit";
import { listWorkOrders, listItems, type WorkOrder } from "@/lib/api/mfg";

const SHIFTS = [
  { id: "morning",   label: "Morning",   start: 6,  end: 14 },
  { id: "afternoon", label: "Afternoon", start: 14, end: 22 },
  { id: "night",     label: "Night",     start: 22, end: 6  },
];

function getShift(date: Date): string {
  const h = date.getHours();
  if (h >= 6 && h < 14) return "morning";
  if (h >= 14 && h < 22) return "afternoon";
  return "night";
}

function exportCSV(filename: string, rows: string[][]): void {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ShiftReportPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [selectedShift, setSelectedShift] = useState<string>("morning");

  useEffect(() => {
    listWorkOrders()
      .then(setWorkOrders)
      .catch(() => setWorkOrders([]))
      .finally(() => setLoading(false));
  }, []);

  const shiftWOs = useMemo(() => {
    const shift = SHIFTS.find((s) => s.id === selectedShift);
    if (!shift) return [];
    return workOrders.filter((wo) => {
      if (!wo.updated_at && !wo.created_at) return false;
      const d = new Date(wo.updated_at ?? wo.created_at ?? "");
      const dateMatch = d.toISOString().split("T")[0] === selectedDate;
      const shiftMatch = getShift(d) === selectedShift;
      return dateMatch && shiftMatch;
    });
  }, [workOrders, selectedDate, selectedShift]);

  const summary = useMemo(() => {
    const total = shiftWOs.length;
    const completed = shiftWOs.filter((w) => w.status === "completed").length;
    const inProgress = shiftWOs.filter((w) => w.status === "in_progress").length;
    const planned = shiftWOs.filter((w) => w.status === "planned" || w.status === "released").length;
    const cancelled = shiftWOs.filter((w) => w.status === "cancelled").length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, planned, cancelled, completionRate };
  }, [shiftWOs]);

  const shiftLabel = SHIFTS.find((s) => s.id === selectedShift)?.label ?? "";

  function handleExport() {
    exportCSV(`shift-report-${selectedDate}-${selectedShift}.csv`, [
      ["WO Code", "Item", "Status", "Qty", "Work Center", "Updated"],
      ...shiftWOs.map((wo) => [
        wo.code ?? wo.id.slice(0, 8),
        wo.item_name ?? wo.item_id ?? "—",
        wo.status,
        String(wo.qty ?? "—"),
        wo.work_center_id ?? "—",
        wo.updated_at ?? wo.created_at ?? "—",
      ]),
    ]);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: "MFG", href: "/mfg/home" }, { label: "Shift Report" }]} />

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Shift Report</h1>
        <Button variant="ghost" size="sm" onClick={handleExport} disabled={shiftWOs.length === 0}>
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium text-ink-muted">Date</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded border border-line bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <div className="flex rounded border border-line overflow-hidden">
          {SHIFTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedShift(s.id)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${selectedShift === s.id ? "bg-accent text-white" : "bg-surface hover:bg-surface-2 text-ink"}`}
            >
              {s.label} ({s.start.toString().padStart(2, "0")}:00–{s.end.toString().padStart(2, "0")}:00)
            </button>
          ))}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: "Total WOs", value: summary.total, color: "text-ink" },
          { label: "Completed", value: summary.completed, color: "text-success" },
          { label: "In Progress", value: summary.inProgress, color: "text-info" },
          { label: "Planned/Released", value: summary.planned, color: "text-warning" },
          { label: "Completion %", value: `${summary.completionRate}%`, color: summary.completionRate >= 80 ? "text-success" : summary.completionRate >= 50 ? "text-warning" : "text-danger" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-sm border border-line bg-surface p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{tile.label}</p>
            <p className={`font-mono text-2xl font-bold tabular-nums ${tile.color}`}>{tile.value}</p>
          </div>
        ))}
      </div>

      {/* Work order list */}
      <div>
        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">
          {shiftLabel} Shift — {selectedDate} ({shiftWOs.length} work orders)
        </h2>

        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-ink-muted">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">WO Code</th>
                  <th className="px-4 py-2 text-left font-medium">Item</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Work Center</th>
                  <th className="px-4 py-2 text-left font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shiftWOs.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-muted">No work orders found for this shift.</td></tr>
                ) : shiftWOs.map((wo) => (
                  <tr key={wo.id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2 font-mono text-xs">{wo.code ?? wo.id.slice(0, 8)}</td>
                    <td className="px-4 py-2">{wo.item_name ?? wo.item_id ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono">{wo.qty ?? "—"}</td>
                    <td className="px-4 py-2">
                      <Tag
                        tone={wo.status === "completed" ? "success" : wo.status === "in_progress" ? "info" : wo.status === "cancelled" ? "danger" : "neutral"}
                        size="sm"
                      >
                        {wo.status}
                      </Tag>
                    </td>
                    <td className="px-4 py-2 text-ink-muted font-mono text-xs">{wo.work_center_id ?? "—"}</td>
                    <td className="px-4 py-2 text-ink-muted">{wo.updated_at ? new Date(wo.updated_at).toLocaleTimeString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
```

### Step 4.3 — Commit

```bash
git add "apps/web/app/(shell)/mfg/shift-report/" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan23): MFG Shift Report — daily production summary by shift with CSV export"
```

---

## Task 5: Typecheck

- [ ] **Run typecheck across all changes**

```bash
cd /Users/sakdachoommanee/Documents/projectmanagment
pnpm --filter web typecheck 2>&1 | tail -20
```

Fix all type errors before committing. Repeat until zero errors.

**Common issues to watch for:**
- `WorkOrder` fields: check actual type in `mfg.ts` — fields like `code`, `item_name`, `work_center_id`, `qty`, `updated_at` may not all exist. Use optional chaining `?.` everywhere.
- `PurchaseOrder.lines` may not be on the list type — only on the detail type from `getPurchaseOrder()`. Use `POLine` type for the dialog.
- `listPurchaseOrders` may not accept a `status` param — check the function signature and add if needed.
