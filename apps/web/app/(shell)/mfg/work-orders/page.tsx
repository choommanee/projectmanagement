"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog, EmptyState, LoadingState } from "@pmplatform/ui-kit";
import { listWorkOrders, createWorkOrder, updateWorkOrder, deleteWorkOrder, listItems, listWorkCenters, listUoms, type WorkOrder, type WOStatus, type WOPriority, type Item, type WorkCenter } from "@/lib/api/mfg";
import { listSalesOrders, type SalesOrder } from "@/lib/api/sales";

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "planned", label: "Planned" },
  { value: "released", label: "Released" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "closed", label: "Closed" },
  { value: "cancelled", label: "Cancelled" },
];

function statusTone(s: WOStatus): "neutral" | "info" | "accent" | "success" | "warning" | "danger" | "signal" {
  if (s === "planned") return "neutral";
  if (s === "released") return "info";
  if (s === "in_progress") return "accent";
  if (s === "completed") return "success";
  if (s === "closed") return "warning";
  if (s === "cancelled") return "danger";
  return "neutral";
}

function priorityTone(p: WOPriority): "neutral" | "info" | "warning" | "danger" {
  if (p === "low") return "neutral";
  if (p === "med") return "info";
  if (p === "high") return "warning";
  if (p === "critical") return "danger";
  return "neutral";
}

function NewWODialog({ open, items, workCenters, salesOrders, onClose, onCreated }: {
  open: boolean; items: Item[]; workCenters: WorkCenter[]; salesOrders: SalesOrder[]; onClose: () => void; onCreated: (wo: WorkOrder) => void;
}) {
  const [form, setForm] = useState({
    code: "", item_id: items[0]?.id ?? "", qty: "1", due_date: "",
    priority: "med" as WOPriority, work_center_id: "", source_so_id: "",
  });
  const [itemQuery, setItemQuery] = useState(items[0] ? `${items[0].code} — ${items[0].name}` : "");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchItem(q: string) {
    if (!q.trim()) { setItemResults([]); return; }
    try { const r = await listItems({ q, limit: 10 }); setItemResults(r.items); } catch { /* noop */ }
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.code || !form.item_id || Number(form.qty) <= 0) { setError("Code, Item, and Qty > 0 required"); return; }
    setLoading(true);
    setError(null);
    try {
      const wo = await createWorkOrder({
        code: form.code, item_id: form.item_id, qty: Number(form.qty),
        due_date: form.due_date || undefined, priority: form.priority,
        work_center_id: form.work_center_id || undefined,
        source_so_id: form.source_so_id || undefined,
      });
      onCreated(wo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create WO");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New work order"
      description="Released WOs deduct material reservations; planned WOs are scope-only"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>Create WO</Button>
        </>
      }
    >
        <form onSubmit={submit} className="space-y-4">
          {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">WO Code *</label>
              <Input value={form.code} onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))} placeholder="WO-001" required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Qty *</label>
              <Input type="number" min="1" step="any" value={form.qty} onChange={(e) => setForm(f => ({ ...f, qty: e.target.value }))} required />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Item *</label>
            <div className="relative">
              <Input value={itemQuery} onChange={(e) => { setItemQuery(e.target.value); void searchItem(e.target.value); }} placeholder="Search item code…" />
              {itemResults.length > 0 && (
                <ul className="absolute left-0 top-full z-30 mt-1 w-full rounded-sm border border-line bg-surface shadow-pop">
                  {itemResults.map(it => (
                    <li key={it.id} className="cursor-pointer px-3 py-1.5 text-xs hover:bg-surface-2"
                      onClick={() => { setForm(f => ({ ...f, item_id: it.id })); setItemQuery(`${it.code} — ${it.name}`); setItemResults([]); }}>
                      <span className="font-mono">{it.code}</span> — {it.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Due Date</label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm(f => ({ ...f, due_date: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Priority</label>
              <select aria-label="Priority" value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value as WOPriority }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                <option value="low">Low</option>
                <option value="med">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          {workCenters.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Work Center (optional)</label>
              <select aria-label="Work center" value={form.work_center_id} onChange={(e) => setForm(f => ({ ...f, work_center_id: e.target.value }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                <option value="">— none —</option>
                {workCenters.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Source Sales Order (optional)</label>
            <select aria-label="Source sales order" value={form.source_so_id} onChange={(e) => setForm(f => ({ ...f, source_so_id: e.target.value }))}
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
              <option value="">— none —</option>
              {salesOrders.map(so => <option key={so.id} value={so.id}>{so.soNumber || so.id.slice(0, 8)}</option>)}
            </select>
          </div>
        </form>
    </Dialog>
  );
}

// ── Edit WO Dialog ────────────────────────────────────────────────────────────

const EDITABLE_STATUSES: WOStatus[] = ["planned", "released", "in_progress", "completed", "closed", "cancelled"];

function EditWODialog({ wo, workCenters, salesOrders, open, onClose, onSaved }: {
  wo: WorkOrder | null; workCenters: WorkCenter[]; salesOrders: SalesOrder[]; open: boolean; onClose: () => void; onSaved: (updated: WorkOrder) => void;
}) {
  const [status, setStatus] = useState<WOStatus>("planned");
  const [priority, setPriority] = useState<WOPriority>("med");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [wcId, setWcId] = useState("");
  const [soId, setSoId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wo) {
      setStatus(wo.status);
      setPriority(wo.priority);
      setDueDate(wo.dueDate ? wo.dueDate.slice(0, 10) : "");
      setNotes(wo.notes);
      setWcId(wo.workCenterId ?? "");
      setSoId(wo.sourceSoId ?? "");
      setError(null);
    }
  }, [wo]);

  async function submit() {
    if (!wo) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await updateWorkOrder(wo.id, {
        status,
        priority,
        due_date: dueDate || null,
        notes,
        work_center_id: wcId || null,
        source_so_id: soId || null,
        version: wo.version,
      });
      onSaved(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const fieldCls = "h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit work order"
      description={wo ? `WO ${wo.code} — update status, priority, dates, notes` : ""}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>Save changes</Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Status</label>
            <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as WOStatus)} className={fieldCls}>
              {EDITABLE_STATUSES.map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Priority</label>
            <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as WOPriority)} className={fieldCls}>
              {(["low","med","high","critical"] as WOPriority[]).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Due Date</label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        {workCenters.length > 0 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Work Center</label>
            <select aria-label="Work center" value={wcId} onChange={(e) => setWcId(e.target.value)} className={fieldCls}>
              <option value="">— none —</option>
              {workCenters.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Source Sales Order</label>
          <select aria-label="Source sales order" value={soId} onChange={(e) => setSoId(e.target.value)} className={fieldCls}>
            <option value="">— none —</option>
            {salesOrders.map(so => <option key={so.id} value={so.id}>{so.soNumber || so.id.slice(0, 8)}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 resize-none"
          />
        </div>
      </div>
    </Dialog>
  );
}

// ── Delete WO Dialog ──────────────────────────────────────────────────────────

function DeleteWODialog({ wo, open, onClose, onDeleted }: {
  wo: WorkOrder | null; open: boolean; onClose: () => void; onDeleted: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (wo) setError(null); }, [wo]);

  async function submit() {
    if (!wo) return;
    setLoading(true);
    setError(null);
    try {
      await deleteWorkOrder(wo.id, wo.version);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Cancel work order"
      description="This marks the WO as cancelled. It cannot be undone."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Back</Button>
          <Button variant="danger" loading={loading} onClick={() => void submit()}>Cancel WO</Button>
        </>
      }
    >
      {wo && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            Work order <span className="font-mono font-semibold text-ink">{wo.code}</span> will be cancelled.
          </p>
          {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkOrdersPage() {
  const router = useRouter();
  const [wos, setWos] = useState<WorkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [wcMap, setWcMap] = useState<Map<string, WorkCenter>>(new Map());

  const loadMeta = useCallback(async () => {
    try {
      const [itemRes, wcRes, soRes] = await Promise.all([listItems({ limit: 500 }), listWorkCenters(), listSalesOrders({ limit: 200 })]);
      setItems(itemRes.items);
      setWorkCenters(wcRes);
      setSalesOrders(soRes.items);
      setItemMap(new Map(itemRes.items.map(i => [i.id, i])));
      setWcMap(new Map(wcRes.map(w => [w.id, w])));
    } catch { /* noop */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listWorkOrders({ status: statusFilter, q, limit: 100 });
      setWos(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load work orders");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, q]);

  useEffect(() => { void loadMeta(); }, [loadMeta]);
  useEffect(() => { void load(); }, [load]);

  function exportCsv() {
    const header = "Code,Item,Qty,Status,Priority,WorkCenter,Due\n";
    const rows = wos.map(w => {
      const item = itemMap.get(w.itemId);
      return `"${w.code}","${item?.code ?? ""}",${w.qty},"${w.status}","${w.priority}","${wcMap.get(w.workCenterId ?? "")?.code ?? ""}","${w.dueDate ?? ""}"`;
    }).join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "work-orders.csv";
    a.click();
  }

  // ── KPI strip ────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const by = { planned: 0, released: 0, in_progress: 0, completed: 0, closed: 0, cancelled: 0 } as Record<string, number>;
    let critical = 0;
    let due7 = 0;
    const sevenDays = new Date(); sevenDays.setDate(sevenDays.getDate() + 7);
    for (const w of wos) {
      by[w.status] = (by[w.status] ?? 0) + 1;
      if (w.priority === "critical") critical++;
      if (w.dueDate && new Date(w.dueDate) <= sevenDays && w.status !== "completed" && w.status !== "closed" && w.status !== "cancelled") due7++;
    }
    return { by, critical, due7 };
  }, [wos]);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Work Orders" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New WO", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
        { id: "export", label: "Export CSV", variant: "ghost", onClick: exportCsv },
      ]} />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
          {/* Editorial header */}
          <header className="reveal-up flex items-end justify-between gap-6 border-b border-line pb-5">
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
                ◢ shop floor · work orders
              </div>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
                Work Orders
              </h1>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">scope</div>
              <div className="font-mono text-[11px] tabular-nums text-ink-2">
                {wos.length}/{total} loaded
              </div>
            </div>
          </header>

          {/* KPI strip */}
          <section className="reveal-up relative overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs" aria-label="Work order KPIs">
            <div aria-hidden className="pointer-events-none absolute inset-0 blueprint-grid" />
            <div className="relative grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-y divide-line lg:divide-y-0 lg:divide-x">
              {[
                { label: "total",        value: total,                tone: "accent" as const },
                { label: "planned",      value: kpis.by.planned,      tone: "accent" as const },
                { label: "released",     value: kpis.by.released,     tone: "accent" as const },
                { label: "in_progress",  value: kpis.by.in_progress,  tone: "accent" as const },
                { label: "completed",    value: kpis.by.completed,    tone: "accent" as const },
                { label: "critical",     value: kpis.critical,        tone: "signal" as const },
                { label: "due ≤7d",      value: kpis.due7,            tone: "signal" as const },
              ].map((k) => (
                <div key={k.label} className="flex flex-col gap-1 px-4 py-4">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${k.tone === "signal" ? "bg-signal" : "bg-accent"}`} />
                    {k.label}
                  </div>
                  <div className={`font-mono text-[22px] font-semibold leading-none tabular-nums ${k.tone === "signal" && Number(k.value) > 0 ? "text-signal" : "text-ink"}`}>
                    {k.value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Filter row */}
          <div className="flex flex-wrap items-center gap-3">
            <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-1">
              {STATUS_TABS.map(t => (
                <button
                  type="button"
                  key={t.value}
                  role="tab"
                  aria-selected={statusFilter === t.value ? "true" : "false"}
                  onClick={() => setStatusFilter(t.value)}
                  className={`h-7 rounded-xs px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors ${
                    statusFilter === t.value
                      ? "bg-ink text-paper"
                      : "border border-line-strong bg-surface text-ink-3 hover:border-accent/40 hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search WOs…" className="ml-auto max-w-48 h-8" aria-label="Search work orders" />
          </div>

          {error && <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>}

          {loading && !wos.length ? (
            <LoadingState rows={5} ariaLabel="Loading work orders" />
          ) : wos.length === 0 ? (
            <EmptyState
              code="◇ no work orders"
              title="No work orders match these filters."
              description="Create a new WO from an item, or adjust filters above."
              action={<Button variant="primary" onClick={() => setShowNew(true)}>+ New WO</Button>}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <th className="px-4 py-2.5">WO Code</th>
                    <th className="px-4 py-2.5">Item</th>
                    <th className="px-4 py-2.5">Qty</th>
                    <th className="px-4 py-2.5">Progress</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Priority</th>
                    <th className="px-4 py-2.5">Work Center</th>
                    <th className="px-4 py-2.5">Due</th>
                    <th className="px-4 py-2.5">v</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {wos.map((wo) => {
                    const item = itemMap.get(wo.itemId);
                    const wc = wcMap.get(wo.workCenterId ?? "");
                    const pct = wo.qty > 0 ? Math.min(100, Math.round((wo.qtyCompleted / wo.qty) * 100)) : 0;
                    return (
                      <tr key={wo.id} onClick={() => router.push(`/mfg/work-orders/${wo.id}`)}
                        className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-paper">
                        <td className="px-4 py-2 font-mono text-xs font-semibold text-ink">{wo.code}</td>
                        <td className="px-4 py-2">
                          <div className="font-mono text-xs text-ink">{item?.code ?? "—"}</div>
                          <div className="text-xs text-ink-3">{item?.name ?? ""}</div>
                        </td>
                        <td className="px-4 py-2 font-mono text-sm tabular-nums">{wo.qty}</td>
                        <td className="px-4 py-2">
                          <div className="text-xs font-mono tabular-nums text-ink-2">{wo.qtyCompleted}/{wo.qty}</div>
                          <div className="mt-1 h-1.5 w-20 rounded-full bg-surface-2">
                            <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-2"><Tag tone={statusTone(wo.status)} dot>{wo.status.replace("_", " ")}</Tag></td>
                        <td className="px-4 py-2"><Tag tone={priorityTone(wo.priority)}>{wo.priority}</Tag></td>
                        <td className="px-4 py-2 font-mono text-xs text-ink-2">{wc?.code ?? "—"}</td>
                        <td className="px-4 py-2 font-mono text-xs tabular-nums text-ink-3">{wo.dueDate ? new Date(wo.dueDate).toLocaleDateString() : "—"}</td>
                        <td className="px-4 py-2 font-mono text-xs tabular-nums text-ink-3">v{wo.version}</td>
                        <td className="px-4 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex gap-1">
                            <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setEditTarget(wo)}>
                              <Pencil size={13} />
                            </Button>
                            <Button variant="ghost" size="sm" aria-label="Cancel WO" onClick={() => setDeleteTarget(wo)}>
                              <Trash2 size={13} className="text-danger" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <NewWODialog open={showNew} items={items} workCenters={workCenters} salesOrders={salesOrders} onClose={() => setShowNew(false)} onCreated={(wo) => { setShowNew(false); router.push(`/mfg/work-orders/${wo.id}`); }} />
      <EditWODialog
        wo={editTarget}
        workCenters={workCenters}
        salesOrders={salesOrders}
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={(updated) => {
          setEditTarget(null);
          setWos(prev => prev.map(w => w.id === updated.id ? updated : w));
        }}
      />
      <DeleteWODialog
        wo={deleteTarget}
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null);
          void load();
        }}
      />
    </div>
  );
}
