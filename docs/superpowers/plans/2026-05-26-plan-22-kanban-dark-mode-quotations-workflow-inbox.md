# Plan #22 — Kanban Board, Dark Mode, Sales Quotations, Workflow Task Inbox

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PM Kanban board view, dark mode toggle, Sales Quotations page, and Workflow human-task inbox. Fix HR leave nav mismatch.

**Architecture:**
- Kanban: new view toggle (List / Kanban) on PM tasks page; drag-free column layout grouped by status
- Dark mode: Tailwind `dark:` classes already supported; add a `data-theme="dark"` toggle on `<html>` persisted to localStorage; TopBar toggle button
- Sales Quotations: new page + API proxy at `/api/sales/quotations`; new nav entry in Sales Hub
- Workflow Inbox: `/pm/inbox` page upgraded to show human-task assignments from workflow-svc
- HR Leave fix: redirect `/hr/leave-requests` → `/hr/leave` via a simple redirect page

**Tech Stack:** Next.js 15, React 19, Tailwind 4, existing proxy pattern

---

## Task 1: Fix HR Leave Nav + Dark Mode Toggle

**Files:**
- Create: `apps/web/app/(shell)/hr/leave-requests/page.tsx` (redirect)
- Modify: `apps/web/src/shell/TopBar.tsx` (dark mode toggle button)
- Modify: `apps/web/app/layout.tsx` or `apps/web/src/shell/AppShell.tsx` (theme class on html)

### Step 1.1 — Fix HR Leave nav mismatch

The nav links to `/hr/leave-requests` but the page is at `/hr/leave`. Create a redirect:

Create `apps/web/app/(shell)/hr/leave-requests/page.tsx`:

```typescript
import { redirect } from "next/navigation";
export default function LeaveRequestsRedirect() {
  redirect("/hr/leave");
}
```

### Step 1.2 — Dark mode: theme toggle

Read `apps/web/src/shell/TopBar.tsx` fully first, then add a dark mode toggle button.

Add a `useDarkMode` hook inline in TopBar:

```typescript
import { useEffect, useState } from "react";

function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("theme") === "dark";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [dark]);

  return { dark, toggle: () => setDark((d) => !d) };
}
```

Import `Sun` and `Moon` icons from `lucide-react`. In the TopBar render, add a button next to the existing icons (before the notification bell):

```typescript
const { dark, toggle } = useDarkMode();
// ...inside JSX right-side icon row:
<button
  onClick={toggle}
  className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink transition-colors"
  title={dark ? "Switch to light mode" : "Switch to dark mode"}
>
  {dark ? <Sun size={18} /> : <Moon size={18} />}
</button>
```

### Step 1.3 — Add dark: tokens to global CSS

Check `apps/web/src/app/globals.css` (or wherever the CSS variables are defined). Add dark mode overrides:

```css
.dark {
  --color-surface: #0f1117;
  --color-surface-2: #161b22;
  --color-surface-3: #1c2128;
  --color-line: #30363d;
  --color-ink: #e6edf3;
  --color-ink-2: #8b949e;
  --color-ink-3: #6e7681;
}
```

If the project uses Tailwind CSS variables differently, check the design tokens in `packages/design-tokens/` and `apps/web/src/app/globals.css` first, then set the dark mode values appropriately.

### Step 1.4 — Commit

```bash
git add "apps/web/app/(shell)/hr/leave-requests/" "apps/web/src/shell/TopBar.tsx" "apps/web/src/app/globals.css"
git commit -m "feat(plan22): dark mode toggle + HR leave nav fix"
```

---

## Task 2: PM Kanban Board View

**Files:**
- Modify: `apps/web/app/(shell)/pm/tasks/page.tsx`

The tasks page currently shows a table list. Add a "Kanban" view toggle. No drag-and-drop — just column layout.

### Step 2.1 — Read the current tasks page

Read `apps/web/app/(shell)/pm/tasks/page.tsx` fully to understand the data model (`Task`, status values, how tasks are loaded).

### Step 2.2 — Add view toggle state + KanbanBoard component

Add a `view` state (`"list" | "kanban"`) and a toggle in the CommandBar area:

```typescript
const [view, setView] = useState<"list" | "kanban">("list");
```

Add toggle buttons:

```typescript
<div className="flex rounded border border-line overflow-hidden">
  <button
    onClick={() => setView("list")}
    className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${view === "list" ? "bg-accent text-white" : "bg-surface hover:bg-surface-2 text-ink"}`}
  >
    <List size={14} /> List
  </button>
  <button
    onClick={() => setView("kanban")}
    className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${view === "kanban" ? "bg-accent text-white" : "bg-surface hover:bg-surface-2 text-ink"}`}
  >
    <LayoutGrid size={14} /> Kanban
  </button>
</div>
```

Import `List, LayoutGrid` from `lucide-react`.

### Step 2.3 — Build the KanbanBoard component inline

Define a `KanbanBoard` component inside the page file (above the main component):

```typescript
const KANBAN_COLS: Array<{ status: TaskStatus; label: string; tone: string }> = [
  { status: "todo",        label: "To Do",       tone: "text-ink-3" },
  { status: "in_progress", label: "In Progress",  tone: "text-info"  },
  { status: "blocked",     label: "Blocked",      tone: "text-danger"},
  { status: "review",      label: "Review",       tone: "text-warning"},
  { status: "done",        label: "Done",         tone: "text-success"},
];

function KanbanBoard({ tasks, onSelect }: { tasks: Task[]; onSelect: (t: Task) => void }) {
  const byStatus = useMemo(() => {
    const m = new Map<TaskStatus, Task[]>();
    KANBAN_COLS.forEach((c) => m.set(c.status, []));
    tasks.forEach((t) => {
      const col = m.get(t.status as TaskStatus);
      if (col) col.push(t);
    });
    return m;
  }, [tasks]);

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 pt-1">
      {KANBAN_COLS.map(({ status, label, tone }) => {
        const col = byStatus.get(status) ?? [];
        return (
          <div key={status} className="flex w-64 shrink-0 flex-col gap-2">
            {/* Column header */}
            <div className="flex items-center justify-between rounded-sm bg-surface-2 px-3 py-2">
              <span className={`text-xs font-semibold uppercase tracking-wide ${tone}`}>{label}</span>
              <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-mono text-ink-3">{col.length}</span>
            </div>
            {/* Cards */}
            <div className="flex flex-col gap-2">
              {col.length === 0 ? (
                <div className="rounded-sm border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">
                  Empty
                </div>
              ) : col.map((task) => (
                <button
                  key={task.id}
                  onClick={() => onSelect(task)}
                  className="w-full rounded-sm border border-line bg-surface p-3 text-left hover:border-accent/50 hover:bg-surface-2 transition-colors"
                >
                  <p className="text-xs font-mono text-ink-3 mb-1">{task.code}</p>
                  <p className="text-sm font-medium text-ink line-clamp-2">{task.title}</p>
                  {task.priority && (
                    <div className="mt-2">
                      <Tag tone={priorityTone(task.priority)} size="sm">{task.priority}</Tag>
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

The `onSelect` callback should open the existing `TaskSheet` sidebar (same as clicking a task in list view).

### Step 2.4 — Wire it into the main render

In the main component's render, after the filter bar:

```typescript
{view === "list" ? (
  /* existing table JSX */
) : (
  <KanbanBoard
    tasks={filtered}
    onSelect={(task) => { setSelectedTask(task); setSheetOpen(true); }}
  />
)}
```

Look at how the existing list view opens TaskSheet and replicate the same pattern.

### Step 2.5 — Commit

```bash
git add "apps/web/app/(shell)/pm/tasks/page.tsx"
git commit -m "feat(plan22): PM tasks Kanban board view"
```

---

## Task 3: Sales Quotations Page

**Files:**
- Modify: `apps/web/src/lib/mock/apps.ts` (add Quotations to Sales nav)
- Modify: `apps/web/src/lib/api/sales.ts` (add quote types + functions)
- Create: `apps/web/app/(shell)/sales/quotations/page.tsx`
- Create: `apps/web/app/api/sales/quotations/route.ts`
- Create: `apps/web/app/api/sales/quotations/[id]/route.ts`

### Step 3.1 — Add Quotations to Sales Hub nav

Open `apps/web/src/lib/mock/apps.ts`. Find the `id: "sales"` app and its `crm` area. Add quotations:

```typescript
{ id: "crm", name: "CRM", groups: [
  { id: "c1", name: "Sales", subareas: [
    { id: "quotations",   name: "Quotations",   href: "/sales/quotations", icon: "tasks"  },
    { id: "customers",    name: "Customers",    href: "/sales/customers",  icon: "people" },
    { id: "sales-orders", name: "Sales Orders", href: "/sales/orders",     icon: "tasks"  },
  ]},
]},
```

### Step 3.2 — Add quote types to sales.ts

Open `apps/web/src/lib/api/sales.ts`. Add:

```typescript
export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export interface Quote {
  id: string;
  code?: string;
  customer_id: string;
  customer_name?: string;
  title?: string;
  valid_until?: string;
  status: QuoteStatus;
  total_amount?: number;
  notes?: string;
  created_at?: string;
}

export async function listQuotes(params?: { status?: string; customer_id?: string }): Promise<Quote[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.customer_id) q.set("customer_id", params.customer_id);
  const r = await fetch(`/api/sales/quotations?${q}`);
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.quotes ?? [];
}

export async function createQuote(body: Omit<Quote, "id" | "code" | "customer_name">): Promise<Quote> {
  const r = await fetch("/api/sales/quotations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateQuoteStatus(id: string, status: QuoteStatus): Promise<void> {
  const r = await fetch(`/api/sales/quotations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) throw new Error(await r.text());
}
```

### Step 3.3 — Create proxy routes

Create `apps/web/app/api/sales/quotations/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SALES_URL = process.env.SALES_URL ?? "http://localhost:8094";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: (h as { status: number }).status });
  return h;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${SALES_URL}/v1/quotations${url.search}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SALES_URL}/v1/quotations`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

Create `apps/web/app/api/sales/quotations/[id]/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SALES_URL = process.env.SALES_URL ?? "http://localhost:8094";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: (h as { status: number }).status });
  return h;
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${SALES_URL}/v1/quotations/${id}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SALES_URL}/v1/quotations/${id}`, { method: "PATCH", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
```

### Step 3.4 — Create quotations page

Create `apps/web/app/(shell)/sales/quotations/page.tsx`:

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import { listQuotes, createQuote, updateQuoteStatus, listCustomers, type Quote, type QuoteStatus, type Customer } from "@/lib/api/sales";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
];

function statusTone(s: string): "neutral" | "info" | "accent" | "success" | "danger" | "warning" {
  if (s === "draft") return "neutral";
  if (s === "sent") return "info";
  if (s === "accepted") return "success";
  if (s === "rejected") return "danger";
  if (s === "expired") return "warning";
  return "neutral";
}

function fmt(n?: number): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n);
}

function NewQuoteDialog({
  open, customers, onClose, onCreated,
}: { open: boolean; customers: Customer[]; onClose: () => void; onCreated: (q: Quote) => void }) {
  const [form, setForm] = useState({ customer_id: "", title: "", valid_until: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ customer_id: customers[0]?.id ?? "", title: "", valid_until: "", notes: "" });
      setError(null);
    }
  }, [open, customers]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer_id) { setError("Customer is required."); return; }
    setLoading(true);
    try {
      const q = await createQuote({ customer_id: form.customer_id, title: form.title || undefined, valid_until: form.valid_until || undefined, notes: form.notes || undefined, status: "draft" });
      onCreated(q);
    } catch (err) {
      setError(String(err));
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Quotation">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Customer *</span>
          <select
            value={form.customer_id}
            onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Title</span>
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Quote title…" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Valid Until</span>
          <Input type="date" value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Notes</span>
          <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Internal notes…" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create Quote"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function SalesQuotationsPage() {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      listQuotes(statusFilter ? { status: statusFilter } : undefined),
      listCustomers(),
    ]).then(([qr, cr]) => {
      setQuotes(qr.status === "fulfilled" ? qr.value : []);
      setCustomers(cr.status === "fulfilled" ? cr.value : []);
    }).finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, status: QuoteStatus) {
    setProcessing(id);
    try { await updateQuoteStatus(id, status); load(); } finally { setProcessing(null); }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Sales", href: "/sales/home" }, { label: "Quotations" }]} />
      <CommandBar title="Quotations" actions={[{
        id: "new", label: "New Quote", icon: "plus", onClick: () => setNewOpen(true),
      }]} />

      <div className="flex gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`rounded px-3 py-1 text-sm font-medium transition-colors ${statusFilter === opt.value ? "bg-accent text-white" : "bg-surface-2 text-ink hover:bg-surface-3"}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Code</th>
                <th className="px-4 py-2 text-left font-medium">Customer</th>
                <th className="px-4 py-2 text-left font-medium">Title</th>
                <th className="px-4 py-2 text-left font-medium">Valid Until</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {quotes.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-ink-muted">No quotations found.</td></tr>
              ) : quotes.map((q) => (
                <tr key={q.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted">{q.code ?? q.id.slice(0, 8)}</td>
                  <td className="px-4 py-2 font-medium">{q.customer_name ?? q.customer_id}</td>
                  <td className="px-4 py-2 text-ink-muted">{q.title ?? "—"}</td>
                  <td className="px-4 py-2 text-ink-muted">{q.valid_until ? new Date(q.valid_until).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(q.total_amount)}</td>
                  <td className="px-4 py-2">
                    <Tag tone={statusTone(q.status)} size="sm">{q.status}</Tag>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      {q.status === "draft" && (
                        <Button size="sm" variant="ghost" onClick={() => updateStatus(q.id, "sent")} disabled={processing === q.id}>Send</Button>
                      )}
                      {q.status === "sent" && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => updateStatus(q.id, "accepted")} disabled={processing === q.id}>Accept</Button>
                          <Button size="sm" variant="ghost" onClick={() => updateStatus(q.id, "rejected")} disabled={processing === q.id}>Reject</Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewQuoteDialog
        open={newOpen}
        customers={customers}
        onClose={() => setNewOpen(false)}
        onCreated={(q) => { setQuotes((prev) => [q, ...prev]); setNewOpen(false); }}
      />
    </div>
  );
}
```

### Step 3.5 — Commit

```bash
git add "apps/web/app/(shell)/sales/quotations/" "apps/web/app/api/sales/quotations/" "apps/web/src/lib/api/sales.ts" "apps/web/src/lib/mock/apps.ts"
git commit -m "feat(plan22): Sales Quotations page — draft, send, accept, reject"
```

---

## Task 4: Workflow Human Task Inbox (upgrade /pm/inbox)

**Files:**
- Modify: `apps/web/app/(shell)/pm/inbox/page.tsx`
- Modify: `apps/web/src/lib/api/` — add workflow instance/task API functions if missing

### Step 4.1 — Check current inbox page

Read `apps/web/app/(shell)/pm/inbox/page.tsx` fully to understand current implementation.

### Step 4.2 — Check workflow API client

Read `apps/web/src/lib/api/` and check if there's a `workflow.ts` file or similar. If not found, check `apps/web/src/lib/api/mfg.ts` to see how workflow APIs are called.

Also check existing proxy at `apps/web/app/api/workflows/[...path]/route.ts`.

### Step 4.3 — Add workflow task functions

If `apps/web/src/lib/api/workflow.ts` doesn't exist or doesn't have task functions, add them. Check first. Create/extend with:

```typescript
export interface WorkflowInstance {
  id: string;
  definition_id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  created_at: string;
  completed_at?: string;
  input?: Record<string, unknown>;
}

export interface HumanTask {
  id: string;
  instance_id: string;
  step_id: string;
  assignee_id?: string;
  status: "pending" | "completed" | "skipped";
  created_at: string;
  completed_at?: string;
  payload?: Record<string, unknown>;
}

export async function listMyHumanTasks(): Promise<HumanTask[]> {
  const r = await fetch("/api/workflows/human-tasks/mine");
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.tasks ?? [];
}

export async function completeHumanTask(instanceId: string, stepId: string, output: Record<string, unknown>): Promise<void> {
  const r = await fetch(`/api/workflows/instances/${instanceId}/steps/${stepId}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ output }),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function listWorkflowInstances(status?: string): Promise<WorkflowInstance[]> {
  const q = status ? `?status=${status}` : "";
  const r = await fetch(`/api/workflows/instances${q}`);
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.instances ?? [];
}
```

Check if these endpoints already exist in the workflow-svc proxy. The proxy at `apps/web/app/api/workflows/[...path]/route.ts` likely already forwards all paths to workflow-svc — confirm this.

### Step 4.4 — Upgrade the inbox page

Rewrite `apps/web/app/(shell)/pm/inbox/page.tsx` to show:
1. **My Tasks** tab — human tasks assigned to the current user from workflow instances
2. **All Instances** tab — all workflow instances with their status

```typescript
"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag, Button } from "@pmplatform/ui-kit";
import { listMyHumanTasks, listWorkflowInstances, completeHumanTask, type HumanTask, type WorkflowInstance } from "@/lib/api/workflow";

function instanceStatusTone(s: string): "neutral" | "info" | "success" | "danger" {
  if (s === "running") return "info";
  if (s === "completed") return "success";
  if (s === "failed") return "danger";
  return "neutral";
}

export default function WorkflowInboxPage() {
  const [tab, setTab] = useState<"tasks" | "instances">("tasks");
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([listMyHumanTasks(), listWorkflowInstances()])
      .then(([tr, ir]) => {
        setTasks(tr.status === "fulfilled" ? tr.value : []);
        setInstances(ir.status === "fulfilled" ? ir.value : []);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function complete(task: HumanTask) {
    setProcessing(task.id);
    try {
      await completeHumanTask(task.instance_id, task.step_id, { approved: true });
      load();
    } catch { /* ignore */ } finally { setProcessing(null); }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "PM Hub", href: "/pm/home" }, { label: "Workflow Inbox" }]} />
      <h1 className="text-xl font-semibold">Workflow Inbox</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line">
        {([
          { key: "tasks",     label: `My Tasks (${tasks.filter((t) => t.status === "pending").length})` },
          { key: "instances", label: `All Instances (${instances.length})` },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === key ? "border-accent text-accent" : "border-transparent text-ink-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : tab === "tasks" ? (
        <div className="flex flex-col gap-2">
          {tasks.filter((t) => t.status === "pending").length === 0 ? (
            <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center text-sm text-ink-muted">
              No pending tasks — you're all caught up.
            </div>
          ) : tasks.filter((t) => t.status === "pending").map((task) => (
            <div key={task.id} className="flex items-center justify-between rounded-lg border border-line bg-surface p-4 hover:border-accent/40">
              <div>
                <p className="text-sm font-medium">Step: <span className="font-mono text-xs text-ink-muted">{task.step_id}</span></p>
                <p className="text-xs text-ink-muted mt-0.5">
                  Instance: <span className="font-mono">{task.instance_id.slice(0, 8)}…</span>
                  {" · "}Created: {new Date(task.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Tag tone="warning" size="sm">Pending</Tag>
                <Button size="sm" variant="primary" onClick={() => complete(task)} disabled={processing === task.id}>
                  {processing === task.id ? "Completing…" : "Complete"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Instance ID</th>
                <th className="px-4 py-2 text-left font-medium">Definition</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Started</th>
                <th className="px-4 py-2 text-left font-medium">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {instances.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-muted">No workflow instances found.</td></tr>
              ) : instances.map((inst) => (
                <tr key={inst.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted">{inst.id.slice(0, 12)}…</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-muted">{inst.definition_id.slice(0, 12)}…</td>
                  <td className="px-4 py-2">
                    <Tag tone={instanceStatusTone(inst.status)} size="sm">{inst.status}</Tag>
                  </td>
                  <td className="px-4 py-2 text-ink-muted">{new Date(inst.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-ink-muted">{inst.completed_at ? new Date(inst.completed_at).toLocaleString() : "—"}</td>
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

### Step 4.5 — Check if workflow.ts exists; create or extend it

If `apps/web/src/lib/api/workflow.ts` already exists, add the missing functions. If not, create it with the full content from Step 4.3.

### Step 4.6 — Commit

```bash
git add "apps/web/app/(shell)/pm/inbox/page.tsx" "apps/web/src/lib/api/workflow.ts"
git commit -m "feat(plan22): workflow human task inbox — my tasks + all instances"
```

---

## Task 5: Typecheck + Final Commit

- [ ] **Step 1: Run typecheck across all changes**

```bash
cd /Users/sakdachoommanee/Documents/projectmanagment
pnpm --filter web typecheck 2>&1 | tail -20
```

Fix any errors before committing.

- [ ] **Step 2: Run typecheck one more time to confirm zero errors**

```bash
pnpm --filter web typecheck 2>&1 | grep -E "error TS|Found [0-9]"
```

Expected: no output (zero errors).
