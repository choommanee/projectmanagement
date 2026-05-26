# Plan #26 — Performance Reviews, Procurement RFQ, AR/AP Aging, Sales CRM Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** HR Performance Reviews (appraisal cycles + goal tracking), Procurement RFQ (request for quotation to suppliers), Accounting AR/AP Aging report (aging buckets), Sales CRM Pipeline (opportunity Kanban).

**Architecture:**
- Performance Reviews: new `PerformanceReview` type in hr.ts + page + proxy to hr-svc `/v1/performance-reviews`
- RFQ: new `RFQ` type in mfg.ts (uses existing `listSuppliers()` + `listItems()`) + page + proxy to mfg-svc `/v1/rfqs`
- AR/AP Aging: pure client-side computation from existing `listInvoices()` — no new backend needed, just a new page under Accounting
- CRM Pipeline: new `Opportunity` type in sales.ts + page + proxy to sales-svc `/v1/opportunities`

**Tech Stack:** Next.js 15, React 19, Tailwind 4, `@pmplatform/ui-kit`

---

## Task 1: HR — Performance Reviews

**Files:**
- Modify: `apps/web/src/lib/api/hr.ts` (add `PerformanceReview` type + CRUD functions)
- Modify: `apps/web/src/lib/mock/apps.ts` (add Performance Reviews to HR nav)
- Create: `apps/web/app/api/hr/performance-reviews/route.ts` (GET, POST proxy)
- Create: `apps/web/app/api/hr/performance-reviews/[id]/route.ts` (GET, PATCH proxy)
- Create: `apps/web/app/(shell)/hr/performance-reviews/page.tsx`

### Step 1.1 — Read existing HR types

Read `apps/web/src/lib/api/hr.ts` to understand:
- `Employee` fields: `id`, `firstName`, `lastName`, `departmentName`, `positionName`, `status`
- `listEmployees()` return type: `{ items: Employee[]; total: number }` — unwrap `.items`
- The `gid` / `g` helper pattern used for normalizers

### Step 1.2 — Add PerformanceReview type to hr.ts

Append to `apps/web/src/lib/api/hr.ts` after the Leave section:

```typescript
// ─── Performance Reviews ────────────────────────────────────────────────────

export type ReviewStatus = "draft" | "self_review" | "manager_review" | "completed";
export type ReviewRating = 1 | 2 | 3 | 4 | 5;

export interface PerformanceGoal {
  id: string;
  description: string;
  weight: number; // 0–100
  selfRating: ReviewRating | null;
  managerRating: ReviewRating | null;
}

export interface PerformanceReview {
  id: string;
  employeeId: string;
  employeeName: string;
  reviewPeriod: string; // e.g. "2026-H1"
  status: ReviewStatus;
  overallRating: ReviewRating | null;
  goals: PerformanceGoal[];
  managerComments: string;
  selfComments: string;
  createdAt: string;
  updatedAt: string;
}

function normGoal(r: Record<string, unknown>): PerformanceGoal {
  return {
    id: String(r.id ?? ""),
    description: String(g(r, "description") ?? ""),
    weight: Number(g(r, "weight") ?? 0),
    selfRating: (gid(r, "selfRating", "self_rating") as ReviewRating | null) ?? null,
    managerRating: (gid(r, "managerRating", "manager_rating") as ReviewRating | null) ?? null,
  };
}

function normReview(r: Record<string, unknown>): PerformanceReview {
  return {
    id: String(r.id ?? ""),
    employeeId: String(gid(r, "employeeId", "employee_id") ?? ""),
    employeeName: String(gid(r, "employeeName", "employee_name") ?? ""),
    reviewPeriod: String(gid(r, "reviewPeriod", "review_period") ?? ""),
    status: (g(r, "status") ?? "draft") as ReviewStatus,
    overallRating: (gid(r, "overallRating", "overall_rating") as ReviewRating | null) ?? null,
    goals: Array.isArray(r.goals) ? (r.goals as Record<string, unknown>[]).map(normGoal) : [],
    managerComments: String(gid(r, "managerComments", "manager_comments") ?? ""),
    selfComments: String(gid(r, "selfComments", "self_comments") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

export async function listPerformanceReviews(params?: {
  status?: ReviewStatus;
  employee_id?: string;
}): Promise<{ items: PerformanceReview[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.employee_id) sp.set("employee_id", params.employee_id);
  const r = await apiFetch(`${SVC}/performance-reviews?${sp}`);
  if (!r.ok) throw new Error(`listPerformanceReviews: ${r.status}`);
  const data = await r.json();
  if (Array.isArray(data)) return { items: (data as Record<string, unknown>[]).map(normReview), total: data.length };
  const obj = data as Record<string, unknown>;
  return { items: Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normReview) : [], total: Number(obj.total ?? 0) };
}

export async function createPerformanceReview(input: {
  employee_id: string;
  review_period: string;
}): Promise<PerformanceReview> {
  const r = await apiFetch(`${SVC}/performance-reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createPerformanceReview: ${r.status}`);
  return normReview(await r.json());
}

export async function updatePerformanceReview(
  id: string,
  patch: Partial<{
    status: ReviewStatus;
    overall_rating: ReviewRating;
    self_comments: string;
    manager_comments: string;
  }>
): Promise<PerformanceReview> {
  const r = await apiFetch(`${SVC}/performance-reviews/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updatePerformanceReview: ${r.status}`);
  return normReview(await r.json());
}
```

### Step 1.3 — Create proxy routes

Read `apps/web/app/api/hr/payroll-runs/route.ts` to understand the exact proxy pattern.

Create `apps/web/app/api/hr/performance-reviews/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/proxy";

const HR_URL = process.env.HR_SERVICE_URL ?? "http://localhost:8096";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: 401 });
  return h;
}

export async function GET(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const url = new URL(req.url);
  const res = await fetch(`${HR_URL}/v1/performance-reviews${url.search}`, { headers: h });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const body = await req.json();
  const res = await fetch(`${HR_URL}/v1/performance-reviews`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

Create `apps/web/app/api/hr/performance-reviews/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/proxy";

const HR_URL = process.env.HR_SERVICE_URL ?? "http://localhost:8096";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: 401 });
  return h;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const res = await fetch(`${HR_URL}/v1/performance-reviews/${id}`, { headers: h });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const body = await req.json();
  const res = await fetch(`${HR_URL}/v1/performance-reviews/${id}`, {
    method: "PATCH",
    headers: h,
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

### Step 1.4 — Add nav entry to apps.ts

In `apps/web/src/lib/mock/apps.ts`, find the HR payroll area. Add after Leave Requests:

```typescript
{ id: "performance", name: "Performance Reviews", href: "/hr/performance-reviews", icon: "tasks" },
```

### Step 1.5 — Create the Performance Reviews page

Create `apps/web/app/(shell)/hr/performance-reviews/page.tsx`:

```typescript
"use client";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listPerformanceReviews, createPerformanceReview, updatePerformanceReview,
  listEmployees,
  type PerformanceReview, type ReviewStatus, type Employee,
} from "@/lib/api/hr";

const STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Draft",
  self_review: "Self Review",
  manager_review: "Manager Review",
  completed: "Completed",
};

const STATUS_COLORS: Record<ReviewStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  self_review: "bg-blue-100 text-blue-700",
  manager_review: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
};

const RATINGS = [1, 2, 3, 4, 5] as const;

export default function PerformanceReviewsPage() {
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<ReviewStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newEmpId, setNewEmpId] = useState("");
  const [newPeriod, setNewPeriod] = useState("2026-H1");
  const [selected, setSelected] = useState<PerformanceReview | null>(null);

  useEffect(() => {
    Promise.all([
      listPerformanceReviews().then(r => setReviews(r.items)),
      listEmployees().then(r => setEmployees(r.items)),
    ]).finally(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? reviews : reviews.filter(r => r.status === filter);

  async function handleCreate() {
    if (!newEmpId || !newPeriod) return;
    const rev = await createPerformanceReview({ employee_id: newEmpId, review_period: newPeriod });
    setReviews(prev => [rev, ...prev]);
    setShowNew(false);
    setNewEmpId("");
  }

  async function advanceStatus(rev: PerformanceReview) {
    const next: Record<ReviewStatus, ReviewStatus | null> = {
      draft: "self_review",
      self_review: "manager_review",
      manager_review: "completed",
      completed: null,
    };
    const nextStatus = next[rev.status];
    if (!nextStatus) return;
    const updated = await updatePerformanceReview(rev.id, { status: nextStatus });
    setReviews(prev => prev.map(r => r.id === updated.id ? updated : r));
    if (selected?.id === updated.id) setSelected(updated);
  }

  const ratingStars = (n: number | null) =>
    n == null ? <span className="text-muted-foreground text-xs">—</span> :
      <span className="text-amber-500">{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Performance Reviews" }]} />

      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-4">
        {(["draft", "self_review", "manager_review", "completed"] as ReviewStatus[]).map(s => (
          <div key={s} className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs text-muted-foreground mb-1">{STATUS_LABELS[s]}</div>
            <div className="text-2xl font-mono font-semibold">
              {reviews.filter(r => r.status === s).length}
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1">
          {(["all", "draft", "self_review", "manager_review", "completed"] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${filter === s ? "bg-accent text-white border-accent" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              {s === "all" ? "All" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/90"
        >
          + New Review
        </button>
      </div>

      {/* New review dialog */}
      {showNew && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <h3 className="text-sm font-medium">Start Performance Review</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Employee</label>
              <select
                value={newEmpId}
                onChange={e => setNewEmpId(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              >
                <option value="">Select employee…</option>
                {employees.filter(e => e.status === "active").map(e => (
                  <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Review Period</label>
              <input
                value={newPeriod}
                onChange={e => setNewPeriod(e.target.value)}
                placeholder="e.g. 2026-H1"
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90">Create</button>
            <button onClick={() => setShowNew(false)} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Employee</th>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Overall Rating</th>
                <th className="px-4 py-2 text-left font-medium">Goals</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No reviews found</td></tr>
              )}
              {filtered.map(rev => (
                <tr key={rev.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => setSelected(rev)}>
                  <td className="px-4 py-3 font-medium">{rev.employeeName}</td>
                  <td className="px-4 py-3 font-mono text-xs">{rev.reviewPeriod}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[rev.status]}`}>
                      {STATUS_LABELS[rev.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">{ratingStars(rev.overallRating)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{rev.goals.length} goals</td>
                  <td className="px-4 py-3 text-right">
                    {rev.status !== "completed" && (
                      <button
                        onClick={e => { e.stopPropagation(); advanceStatus(rev); }}
                        className="px-2 py-1 text-xs rounded border border-border hover:bg-muted"
                      >
                        Advance →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <div className="fixed inset-y-0 right-0 w-96 bg-surface border-l border-border shadow-xl p-6 overflow-y-auto z-50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{selected.employeeName}</h2>
            <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground text-lg">×</button>
          </div>
          <div className="space-y-3 text-sm">
            <div><span className="text-muted-foreground">Period:</span> {selected.reviewPeriod}</div>
            <div><span className="text-muted-foreground">Status:</span>{" "}
              <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[selected.status]}`}>{STATUS_LABELS[selected.status]}</span>
            </div>
            <div><span className="text-muted-foreground">Overall:</span> {ratingStars(selected.overallRating)}</div>
            {selected.selfComments && (
              <div>
                <div className="text-muted-foreground mb-1">Self Comments</div>
                <p className="text-xs bg-muted rounded p-2">{selected.selfComments}</p>
              </div>
            )}
            {selected.managerComments && (
              <div>
                <div className="text-muted-foreground mb-1">Manager Comments</div>
                <p className="text-xs bg-muted rounded p-2">{selected.managerComments}</p>
              </div>
            )}
            {selected.goals.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-2">Goals</div>
                <div className="space-y-2">
                  {selected.goals.map(g => (
                    <div key={g.id} className="border border-border rounded p-2">
                      <div className="text-xs">{g.description}</div>
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                        <span>Weight: {g.weight}%</span>
                        <span>Self: {ratingStars(g.selfRating)}</span>
                        <span>Mgr: {ratingStars(g.managerRating)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Task 2: Procurement — RFQ (Request for Quotation)

**Files:**
- Modify: `apps/web/src/lib/api/mfg.ts` (add `RFQ` + `RFQLine` types + CRUD functions)
- Modify: `apps/web/src/lib/mock/apps.ts` (add RFQ to Procurement nav)
- Create: `apps/web/app/api/mfg/rfqs/route.ts` (GET, POST proxy)
- Create: `apps/web/app/api/mfg/rfqs/[id]/route.ts` (GET, PATCH)
- Create: `apps/web/app/api/mfg/rfqs/[id]/send/route.ts` (POST proxy)
- Create: `apps/web/app/(shell)/procurement/rfqs/page.tsx`

### Step 2.1 — Read mfg.ts supplier + PO types

Read `apps/web/src/lib/api/mfg.ts` lines around `Supplier`, `PurchaseOrder`, `POLine` to understand:
- `Supplier` fields: `id`, `code`, `name`, `contact`, `email`, `leadTimeDays`, `active`
- `Item` fields: `id`, `code`, `name`, `type`
- `listSuppliers()` return: `Supplier[]`
- `listItems()` return: `{ items: Item[]; total: number }` — unwrap `.items`

### Step 2.2 — Add RFQ types to mfg.ts

Append to `apps/web/src/lib/api/mfg.ts` after the PurchaseOrder section:

```typescript
// ─── RFQ ─────────────────────────────────────────────────────────────────────

export type RFQStatus = "draft" | "sent" | "received" | "closed";

export interface RFQLine {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  qtyRequested: number;
  quotedPrice: number | null;
  quotedLeadDays: number | null;
  notes: string;
}

export interface RFQ {
  id: string;
  rfqNumber: string;
  supplierId: string;
  supplierName: string;
  status: RFQStatus;
  sentAt: string | null;
  responseDeadline: string | null;
  lines: RFQLine[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function normRFQLine(r: Record<string, unknown>): RFQLine {
  return {
    id: String(r.id ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? ""),
    itemCode: String(gid(r, "itemCode", "item_code") ?? ""),
    itemName: String(gid(r, "itemName", "item_name") ?? ""),
    qtyRequested: Number(gid(r, "qtyRequested", "qty_requested") ?? 0),
    quotedPrice: (gid(r, "quotedPrice", "quoted_price") as number | null) ?? null,
    quotedLeadDays: (gid(r, "quotedLeadDays", "quoted_lead_days") as number | null) ?? null,
    notes: String(g(r, "notes") ?? ""),
  };
}

function normRFQ(r: Record<string, unknown>): RFQ {
  return {
    id: String(r.id ?? ""),
    rfqNumber: String(gid(r, "rfqNumber", "rfq_number") ?? r["RFQNumber"] ?? ""),
    supplierId: String(gid(r, "supplierId", "supplier_id") ?? r["SupplierID"] ?? ""),
    supplierName: String(gid(r, "supplierName", "supplier_name") ?? ""),
    status: (g(r, "status") ?? "draft") as RFQStatus,
    sentAt: (gid(r, "sentAt", "sent_at") as string | null) ?? null,
    responseDeadline: (gid(r, "responseDeadline", "response_deadline") as string | null) ?? null,
    lines: Array.isArray(r.lines) ? (r.lines as Record<string, unknown>[]).map(normRFQLine) : [],
    notes: String(g(r, "notes") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

export async function listRFQs(params: { status?: RFQStatus; limit?: number; offset?: number } = {}): Promise<{ items: RFQ[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.offset) sp.set("offset", String(params.offset));
  const r = await apiFetch(`${SVC}/rfqs?${sp}`);
  if (!r.ok) throw new Error(`listRFQs failed: ${r.status}`);
  const body = await r.json() as Record<string, unknown>;
  return { items: ((body.items ?? body ?? []) as Record<string, unknown>[]).map(normRFQ), total: Number(body.total ?? 0) };
}

export async function createRFQ(input: { supplier_id: string; response_deadline?: string; notes?: string }): Promise<RFQ> {
  const r = await apiFetch(`${SVC}/rfqs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createRFQ failed: ${r.status}`); }
  return normRFQ(await r.json());
}

export async function sendRFQ(id: string): Promise<RFQ> {
  const r = await apiFetch(`${SVC}/rfqs/${id}/send`, { method: "POST" });
  if (!r.ok) throw new Error(`sendRFQ failed: ${r.status}`);
  return normRFQ(await r.json());
}

export async function addRFQLine(rfqId: string, line: { item_id: string; qty_requested: number; notes?: string }): Promise<RFQLine> {
  const r = await apiFetch(`${SVC}/rfqs/${rfqId}/lines`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(line),
  });
  if (!r.ok) throw new Error(`addRFQLine failed: ${r.status}`);
  return normRFQLine(await r.json());
}
```

### Step 2.3 — Create proxy routes

Read `apps/web/app/api/mfg/purchase-orders/route.ts` to understand the MFG proxy pattern and `MFG_URL`.

Create `apps/web/app/api/mfg/rfqs/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/proxy";

const MFG_URL = process.env.MFG_SERVICE_URL ?? "http://localhost:8085";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: 401 });
  return h;
}

export async function GET(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const url = new URL(req.url);
  const res = await fetch(`${MFG_URL}/v1/rfqs${url.search}`, { headers: h });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const body = await req.json();
  const res = await fetch(`${MFG_URL}/v1/rfqs`, {
    method: "POST", headers: h, body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

Create `apps/web/app/api/mfg/rfqs/[id]/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/proxy";

const MFG_URL = process.env.MFG_SERVICE_URL ?? "http://localhost:8085";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: 401 });
  return h;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const res = await fetch(`${MFG_URL}/v1/rfqs/${id}`, { headers: h });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const body = await req.json();
  const res = await fetch(`${MFG_URL}/v1/rfqs/${id}`, {
    method: "PATCH", headers: h, body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

Create `apps/web/app/api/mfg/rfqs/[id]/send/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/proxy";

const MFG_URL = process.env.MFG_SERVICE_URL ?? "http://localhost:8085";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: 401 });
  const res = await fetch(`${MFG_URL}/v1/rfqs/${id}/send`, { method: "POST", headers: h });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

### Step 2.4 — Add RFQ nav to apps.ts

In `apps/web/src/lib/mock/apps.ts`, find the Procurement area. Add after Purchase Orders:

```typescript
{ id: "rfqs", name: "RFQ", href: "/procurement/rfqs", icon: "tasks" },
```

### Step 2.5 — Create the RFQ page

Create `apps/web/app/(shell)/procurement/rfqs/page.tsx`:

```typescript
"use client";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listRFQs, createRFQ, sendRFQ, listSuppliers,
  type RFQ, type RFQStatus, type Supplier,
} from "@/lib/api/mfg";

const STATUS_LABELS: Record<RFQStatus, string> = {
  draft: "Draft", sent: "Sent", received: "Received", closed: "Closed",
};

const STATUS_COLORS: Record<RFQStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  sent: "bg-blue-100 text-blue-700",
  received: "bg-green-100 text-green-700",
  closed: "bg-zinc-200 text-zinc-500",
};

export default function RFQPage() {
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filter, setFilter] = useState<RFQStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newSupplierId, setNewSupplierId] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [selected, setSelected] = useState<RFQ | null>(null);

  useEffect(() => {
    Promise.all([
      listRFQs({ limit: 100 }).then(r => setRfqs(r.items)),
      listSuppliers().then(setSuppliers),
    ]).finally(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? rfqs : rfqs.filter(r => r.status === filter);

  async function handleCreate() {
    if (!newSupplierId) return;
    const rfq = await createRFQ({ supplier_id: newSupplierId, response_deadline: newDeadline || undefined });
    setRfqs(prev => [rfq, ...prev]);
    setShowNew(false);
    setNewSupplierId("");
    setNewDeadline("");
  }

  async function handleSend(rfq: RFQ) {
    const updated = await sendRFQ(rfq.id);
    setRfqs(prev => prev.map(r => r.id === updated.id ? updated : r));
    if (selected?.id === updated.id) setSelected(updated);
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Procurement" }, { label: "RFQ" }]} />

      {/* Summary tiles */}
      <div className="grid grid-cols-4 gap-4">
        {(["draft", "sent", "received", "closed"] as RFQStatus[]).map(s => (
          <div key={s} className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs text-muted-foreground mb-1">{STATUS_LABELS[s]}</div>
            <div className="text-2xl font-mono font-semibold">{rfqs.filter(r => r.status === s).length}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1">
          {(["all", "draft", "sent", "received", "closed"] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${filter === s ? "bg-accent text-white border-accent" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              {s === "all" ? "All" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)} className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/90">
          + New RFQ
        </button>
      </div>

      {/* New RFQ dialog */}
      {showNew && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <h3 className="text-sm font-medium">Create RFQ</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Supplier</label>
              <select
                value={newSupplierId}
                onChange={e => setNewSupplierId(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              >
                <option value="">Select supplier…</option>
                {suppliers.filter(s => s.active).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Response Deadline</label>
              <input
                type="date"
                value={newDeadline}
                onChange={e => setNewDeadline(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90">Create</button>
            <button onClick={() => setShowNew(false)} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">RFQ #</th>
                <th className="px-4 py-2 text-left font-medium">Supplier</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Lines</th>
                <th className="px-4 py-2 text-left font-medium">Deadline</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No RFQs found</td></tr>
              )}
              {filtered.map(rfq => (
                <tr key={rfq.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => setSelected(rfq)}>
                  <td className="px-4 py-3 font-mono text-xs">{rfq.rfqNumber}</td>
                  <td className="px-4 py-3">{rfq.supplierName}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[rfq.status]}`}>
                      {STATUS_LABELS[rfq.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{rfq.lines.length}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {rfq.responseDeadline ? new Date(rfq.responseDeadline).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {rfq.status === "draft" && (
                      <button
                        onClick={e => { e.stopPropagation(); handleSend(rfq); }}
                        className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                      >
                        Send to Supplier
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <div className="fixed inset-y-0 right-0 w-96 bg-surface border-l border-border shadow-xl p-6 overflow-y-auto z-50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-sm">{selected.rfqNumber}</h2>
            <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground text-lg">×</button>
          </div>
          <div className="space-y-3 text-sm">
            <div><span className="text-muted-foreground">Supplier:</span> {selected.supplierName}</div>
            <div><span className="text-muted-foreground">Status:</span>{" "}
              <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[selected.status]}`}>{STATUS_LABELS[selected.status]}</span>
            </div>
            {selected.responseDeadline && (
              <div><span className="text-muted-foreground">Deadline:</span> {new Date(selected.responseDeadline).toLocaleDateString()}</div>
            )}
            {selected.notes && <div><span className="text-muted-foreground">Notes:</span> {selected.notes}</div>}
            {selected.lines.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-2">Lines</div>
                <div className="space-y-1">
                  {selected.lines.map((l, i) => (
                    <div key={l.id} className="border border-border rounded p-2 text-xs">
                      <div className="font-medium">{l.itemCode} — {l.itemName}</div>
                      <div className="text-muted-foreground mt-0.5">
                        Qty: {l.qtyRequested}
                        {l.quotedPrice != null && ` · Price: ${l.quotedPrice.toLocaleString()}`}
                        {l.quotedLeadDays != null && ` · Lead: ${l.quotedLeadDays}d`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Task 3: Accounting — AR/AP Aging

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Aging to Accounting nav)
- Create: `apps/web/app/(shell)/accounting/aging/page.tsx`

No new proxy routes needed — uses existing `listInvoices()` from accounting.ts.

### Step 3.1 — Read accounting API

Read `apps/web/src/lib/api/accounting.ts`. Confirm:
- `Invoice` type fields: `id`, `invNo`, `invType` (`"AR" | "AP"`), `counterparty`, `amount`, `currency`, `status`, `issueDate`, `dueDate`
- `InvStatus` values: `"draft" | "issued" | "paid" | "cancelled" | "overdue"`
- `listInvoices(params?: { type?: InvType; status?: InvStatus })` return type (check if it returns array or `{ items, total }`)

### Step 3.2 — Add Aging to apps.ts

In `apps/web/src/lib/mock/apps.ts`, find Accounting General Ledger area. Add after Budget:

```typescript
{ id: "aging", name: "AR/AP Aging", href: "/accounting/aging", icon: "tasks" },
```

### Step 3.3 — Create the Aging page

Create `apps/web/app/(shell)/accounting/aging/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listInvoices, type Invoice, type InvType } from "@/lib/api/accounting";

type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

function getBucket(dueDate: string): AgingBucket {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  const diffDays = Math.floor((today.getTime() - due.getTime()) / 86400000);
  if (diffDays <= 0) return "current";
  if (diffDays <= 30) return "1-30";
  if (diffDays <= 60) return "31-60";
  if (diffDays <= 90) return "61-90";
  return "90+";
}

const BUCKET_LABELS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

const BUCKET_COLORS: Record<AgingBucket, string> = {
  current: "text-green-600",
  "1-30": "text-amber-500",
  "31-60": "text-orange-500",
  "61-90": "text-red-500",
  "90+": "text-red-700",
};

export default function AgingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tab, setTab] = useState<InvType>("AR");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load both AR and AP — only outstanding invoices (issued + overdue)
    Promise.all([
      listInvoices({ type: "AR" }),
      listInvoices({ type: "AP" }),
    ]).then(([ar, ap]) => {
      // listInvoices may return array or { items, total } — handle both
      const toArr = (r: unknown): Invoice[] =>
        Array.isArray(r) ? r as Invoice[] : ((r as { items?: Invoice[] }).items ?? []);
      setInvoices([...toArr(ar), ...toArr(ap)]);
    }).finally(() => setLoading(false));
  }, []);

  const outstanding = useMemo(() =>
    invoices.filter(inv => inv.invType === tab && (inv.status === "issued" || inv.status === "overdue")),
    [invoices, tab]
  );

  const byCounterparty = useMemo(() => {
    const map = new Map<string, Record<AgingBucket, number> & { total: number }>();
    for (const inv of outstanding) {
      if (!map.has(inv.counterparty)) {
        map.set(inv.counterparty, { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 });
      }
      const row = map.get(inv.counterparty)!;
      const bucket = getBucket(inv.dueDate);
      row[bucket] += inv.amount;
      row.total += inv.amount;
    }
    return Array.from(map.entries()).map(([name, buckets]) => ({ name, ...buckets }))
      .sort((a, b) => b.total - a.total);
  }, [outstanding]);

  const totals = useMemo(() =>
    BUCKET_LABELS.reduce((acc, b) => {
      acc[b] = byCounterparty.reduce((s, r) => s + r[b], 0);
      return acc;
    }, {} as Record<AgingBucket, number>),
    [byCounterparty]
  );

  const grandTotal = BUCKET_LABELS.reduce((s, b) => s + (totals[b] ?? 0), 0);

  const fmt = (n: number) => n === 0 ? "—" : n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Accounting" }, { label: "AR/AP Aging" }]} />

      {/* AR/AP tabs */}
      <div className="flex gap-1">
        {(["AR", "AP"] as InvType[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-md border transition-colors ${tab === t ? "bg-accent text-white border-accent" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            {t === "AR" ? "Accounts Receivable" : "Accounts Payable"}
          </button>
        ))}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-5 gap-3">
        {BUCKET_LABELS.map(b => (
          <div key={b} className="rounded-lg border border-border bg-surface p-3">
            <div className="text-xs text-muted-foreground mb-1">
              {b === "current" ? "Current" : `${b} days`}
            </div>
            <div className={`text-lg font-mono font-semibold ${BUCKET_COLORS[b]}`}>
              {fmt(totals[b] ?? 0)}
            </div>
          </div>
        ))}
      </div>

      {/* Total outstanding */}
      <div className="rounded-lg border border-border bg-surface px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-medium">Total Outstanding</span>
        <span className="text-xl font-mono font-bold">{fmt(grandTotal)}</span>
      </div>

      {/* Aging table */}
      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">{tab === "AR" ? "Customer" : "Supplier"}</th>
                {BUCKET_LABELS.map(b => (
                  <th key={b} className="px-4 py-2 text-right font-medium">
                    {b === "current" ? "Current" : `${b}d`}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {byCounterparty.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No outstanding invoices</td></tr>
              )}
              {byCounterparty.map(row => (
                <tr key={row.name} className="border-t border-border hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  {BUCKET_LABELS.map(b => (
                    <td key={b} className={`px-4 py-3 text-right font-mono text-xs ${row[b] > 0 ? BUCKET_COLORS[b] : "text-muted-foreground"}`}>
                      {fmt(row[b])}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-mono font-semibold">{fmt(row.total)}</td>
                </tr>
              ))}
              {/* Totals row */}
              {byCounterparty.length > 0 && (
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-3">Total</td>
                  {BUCKET_LABELS.map(b => (
                    <td key={b} className={`px-4 py-3 text-right font-mono text-xs ${BUCKET_COLORS[b]}`}>
                      {fmt(totals[b] ?? 0)}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-mono">{fmt(grandTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

---

## Task 4: Sales — CRM Pipeline

**Files:**
- Modify: `apps/web/src/lib/api/sales.ts` (add `Opportunity` type + CRUD functions)
- Modify: `apps/web/src/lib/mock/apps.ts` (add Pipeline to Sales nav)
- Create: `apps/web/app/api/sales/opportunities/route.ts` (GET, POST proxy)
- Create: `apps/web/app/api/sales/opportunities/[id]/route.ts` (GET, PATCH proxy)
- Create: `apps/web/app/(shell)/sales/pipeline/page.tsx`

### Step 4.1 — Read sales.ts to understand patterns

Read `apps/web/src/lib/api/sales.ts`. Note:
- `Customer` type: `id`, `code`, `name`, `contact`, `email`
- `listCustomers()` return: `Customer[]`
- The `gid` / `g` helper pattern

### Step 4.2 — Add Opportunity type to sales.ts

Append to `apps/web/src/lib/api/sales.ts`:

```typescript
// ─── CRM Pipeline ──────────────────────────────────────────────────────────

export type OpportunityStage = "prospect" | "qualified" | "proposal" | "negotiation" | "won" | "lost";

export interface Opportunity {
  id: string;
  title: string;
  customerId: string;
  customerName: string;
  stage: OpportunityStage;
  value: number;
  currency: string;
  expectedCloseDate: string | null;
  probability: number; // 0–100
  assignedTo: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function normOpportunity(r: Record<string, unknown>): Opportunity {
  return {
    id: String(r.id ?? ""),
    title: String(g(r, "title") ?? ""),
    customerId: String(gid(r, "customerId", "customer_id") ?? r["CustomerID"] ?? ""),
    customerName: String(gid(r, "customerName", "customer_name") ?? ""),
    stage: (g(r, "stage") ?? "prospect") as OpportunityStage,
    value: Number(g(r, "value") ?? 0),
    currency: String(g(r, "currency") ?? "THB"),
    expectedCloseDate: (gid(r, "expectedCloseDate", "expected_close_date") as string | null) ?? null,
    probability: Number(g(r, "probability") ?? 0),
    assignedTo: String(gid(r, "assignedTo", "assigned_to") ?? ""),
    notes: String(g(r, "notes") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

export async function listOpportunities(params: {
  stage?: OpportunityStage;
  customer_id?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: Opportunity[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.stage) sp.set("stage", params.stage);
  if (params.customer_id) sp.set("customer_id", params.customer_id);
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.offset) sp.set("offset", String(params.offset));
  const r = await apiFetch(`${SVC}/opportunities?${sp}`);
  if (!r.ok) throw new Error(`listOpportunities failed: ${r.status}`);
  const body = await r.json() as Record<string, unknown>;
  if (Array.isArray(body)) return { items: (body as Record<string, unknown>[]).map(normOpportunity), total: (body as unknown[]).length };
  return { items: ((body.items ?? []) as Record<string, unknown>[]).map(normOpportunity), total: Number(body.total ?? 0) };
}

export async function createOpportunity(input: {
  title: string;
  customer_id: string;
  value?: number;
  expected_close_date?: string;
  probability?: number;
  notes?: string;
}): Promise<Opportunity> {
  const r = await apiFetch(`${SVC}/opportunities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createOpportunity failed: ${r.status}`); }
  return normOpportunity(await r.json());
}

export async function updateOpportunity(id: string, patch: Partial<{
  stage: OpportunityStage;
  value: number;
  probability: number;
  expected_close_date: string;
  notes: string;
}>): Promise<Opportunity> {
  const r = await apiFetch(`${SVC}/opportunities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateOpportunity failed: ${r.status}`);
  return normOpportunity(await r.json());
}
```

### Step 4.3 — Create proxy routes

Read `apps/web/app/api/sales/shipments/route.ts` to understand the sales proxy pattern and `SALES_URL`.

Create `apps/web/app/api/sales/opportunities/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/proxy";

const SALES_URL = process.env.SALES_SERVICE_URL ?? "http://localhost:8094";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: 401 });
  return h;
}

export async function GET(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const url = new URL(req.url);
  const res = await fetch(`${SALES_URL}/v1/opportunities${url.search}`, { headers: h });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const body = await req.json();
  const res = await fetch(`${SALES_URL}/v1/opportunities`, {
    method: "POST", headers: h, body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

Create `apps/web/app/api/sales/opportunities/[id]/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/proxy";

const SALES_URL = process.env.SALES_SERVICE_URL ?? "http://localhost:8094";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: 401 });
  return h;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const res = await fetch(`${SALES_URL}/v1/opportunities/${id}`, { headers: h });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const body = await req.json();
  const res = await fetch(`${SALES_URL}/v1/opportunities/${id}`, {
    method: "PATCH", headers: h, body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
```

### Step 4.4 — Add Pipeline nav to apps.ts

In `apps/web/src/lib/mock/apps.ts`, find the Sales CRM nav area. Add before Quotations:

```typescript
{ id: "pipeline", name: "Pipeline", href: "/sales/pipeline", icon: "workflow" },
```

### Step 4.5 — Create the CRM Pipeline page

Create `apps/web/app/(shell)/sales/pipeline/page.tsx`:

```typescript
"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listOpportunities, createOpportunity, updateOpportunity, listCustomers,
  type Opportunity, type OpportunityStage, type Customer,
} from "@/lib/api/sales";

const STAGES: OpportunityStage[] = ["prospect", "qualified", "proposal", "negotiation", "won", "lost"];

const STAGE_LABELS: Record<OpportunityStage, string> = {
  prospect: "Prospect", qualified: "Qualified", proposal: "Proposal",
  negotiation: "Negotiation", won: "Won", lost: "Lost",
};

const STAGE_COLORS: Record<OpportunityStage, string> = {
  prospect: "bg-zinc-100 text-zinc-700",
  qualified: "bg-blue-100 text-blue-700",
  proposal: "bg-indigo-100 text-indigo-700",
  negotiation: "bg-amber-100 text-amber-700",
  won: "bg-green-100 text-green-700",
  lost: "bg-red-100 text-red-700",
};

const STAGE_HEADER_COLORS: Record<OpportunityStage, string> = {
  prospect: "bg-zinc-200",
  qualified: "bg-blue-200",
  proposal: "bg-indigo-200",
  negotiation: "bg-amber-200",
  won: "bg-green-200",
  lost: "bg-red-200",
};

export default function PipelinePage() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCustomerId, setNewCustomerId] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newCloseDate, setNewCloseDate] = useState("");

  useEffect(() => {
    Promise.all([
      listOpportunities({ limit: 200 }).then(r => setOpps(r.items)),
      listCustomers().then(setCustomers),
    ]).finally(() => setLoading(false));
  }, []);

  const byStage = useMemo(() => {
    const m = new Map<OpportunityStage, Opportunity[]>();
    for (const s of STAGES) m.set(s, []);
    for (const o of opps) (m.get(o.stage) ?? []).push(o);
    return m;
  }, [opps]);

  const totalPipeline = useMemo(() =>
    opps.filter(o => o.stage !== "lost").reduce((s, o) => s + o.value, 0), [opps]);

  const wonValue = useMemo(() =>
    opps.filter(o => o.stage === "won").reduce((s, o) => s + o.value, 0), [opps]);

  async function handleCreate() {
    if (!newTitle || !newCustomerId) return;
    const opp = await createOpportunity({
      title: newTitle,
      customer_id: newCustomerId,
      value: newValue ? Number(newValue) : 0,
      expected_close_date: newCloseDate || undefined,
    });
    setOpps(prev => [opp, ...prev]);
    setShowNew(false);
    setNewTitle(""); setNewCustomerId(""); setNewValue(""); setNewCloseDate("");
  }

  async function moveStage(opp: Opportunity, stage: OpportunityStage) {
    const updated = await updateOpportunity(opp.id, { stage });
    setOpps(prev => prev.map(o => o.id === updated.id ? updated : o));
  }

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Sales" }, { label: "Pipeline" }]} />

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Pipeline</div>
          <div className="text-xl font-mono font-bold">{fmt(totalPipeline)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Won</div>
          <div className="text-xl font-mono font-bold text-green-600">{fmt(wonValue)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Open Deals</div>
          <div className="text-xl font-mono font-bold">{opps.filter(o => !["won","lost"].includes(o.stage)).length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Win Rate</div>
          <div className="text-xl font-mono font-bold">
            {opps.filter(o => ["won","lost"].includes(o.stage)).length === 0 ? "—" :
              Math.round(opps.filter(o => o.stage === "won").length / opps.filter(o => ["won","lost"].includes(o.stage)).length * 100) + "%"}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setShowNew(true)} className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/90">
          + New Opportunity
        </button>
      </div>

      {/* New opportunity form */}
      {showNew && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <h3 className="text-sm font-medium">New Opportunity</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Title</label>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" placeholder="Opportunity title" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Customer</label>
              <select value={newCustomerId} onChange={e => setNewCustomerId(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Value (THB)</label>
              <input type="number" value={newValue} onChange={e => setNewValue(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" placeholder="0" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Expected Close</label>
              <input type="date" value={newCloseDate} onChange={e => setNewCloseDate(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90">Create</button>
            <button onClick={() => setShowNew(false)} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {/* Kanban board */}
      <div className="grid grid-cols-6 gap-3 overflow-x-auto">
        {STAGES.map(stage => {
          const cards = byStage.get(stage) ?? [];
          const stageTotal = cards.reduce((s, o) => s + o.value, 0);
          return (
            <div key={stage} className="min-w-[160px]">
              <div className={`rounded-t-lg px-3 py-2 ${STAGE_HEADER_COLORS[stage]}`}>
                <div className="text-xs font-semibold">{STAGE_LABELS[stage]}</div>
                <div className="text-xs text-muted-foreground">{cards.length} · {fmt(stageTotal)}</div>
              </div>
              <div className="rounded-b-lg border border-t-0 border-border bg-surface min-h-[200px] p-2 space-y-2">
                {cards.map(opp => (
                  <div key={opp.id} className="rounded border border-border bg-paper p-2 space-y-1">
                    <div className="text-xs font-medium leading-tight">{opp.title}</div>
                    <div className="text-xs text-muted-foreground">{opp.customerName}</div>
                    <div className="text-xs font-mono font-semibold">{fmt(opp.value)}</div>
                    {opp.expectedCloseDate && (
                      <div className="text-xs text-muted-foreground">
                        Close: {new Date(opp.expectedCloseDate).toLocaleDateString()}
                      </div>
                    )}
                    {/* Stage advance/retreat */}
                    <div className="flex gap-1 pt-1">
                      {STAGES.indexOf(stage) > 0 && STAGES.indexOf(stage) < STAGES.length - 2 && (
                        <button
                          onClick={() => moveStage(opp, STAGES[STAGES.indexOf(stage) - 1])}
                          className="flex-1 text-xs py-0.5 rounded border border-border hover:bg-muted"
                        >←</button>
                      )}
                      {STAGES.indexOf(stage) < STAGES.length - 2 && (
                        <button
                          onClick={() => moveStage(opp, STAGES[STAGES.indexOf(stage) + 1])}
                          className="flex-1 text-xs py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20"
                        >→</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```
