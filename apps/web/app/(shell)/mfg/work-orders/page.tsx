"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import { listWorkOrders, createWorkOrder, listItems, listWorkCenters, listUoms, type WorkOrder, type WOStatus, type WOPriority, type Item, type WorkCenter } from "@/lib/api/mfg";

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

function NewWODialog({ items, workCenters, onClose, onCreated }: {
  items: Item[]; workCenters: WorkCenter[]; onClose: () => void; onCreated: (wo: WorkOrder) => void;
}) {
  const [form, setForm] = useState({
    code: "", item_id: items[0]?.id ?? "", qty: "1", due_date: "",
    priority: "med" as WOPriority, work_center_id: "",
  });
  const [itemQuery, setItemQuery] = useState(items[0] ? `${items[0].code} — ${items[0].name}` : "");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchItem(q: string) {
    if (!q.trim()) { setItemResults([]); return; }
    try { const r = await listItems({ q, limit: 10 }); setItemResults(r.items); } catch { /* noop */ }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code || !form.item_id || Number(form.qty) <= 0) { setError("Code, Item, and Qty > 0 required"); return; }
    setLoading(true);
    setError(null);
    try {
      const wo = await createWorkOrder({
        code: form.code, item_id: form.item_id, qty: Number(form.qty),
        due_date: form.due_date || undefined, priority: form.priority,
        work_center_id: form.work_center_id || undefined,
      });
      onCreated(wo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create WO");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-md border border-line bg-paper shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">New Work Order</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-4">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
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
              <select value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value as WOPriority }))}
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
              <select value={form.work_center_id} onChange={(e) => setForm(f => ({ ...f, work_center_id: e.target.value }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                <option value="">— none —</option>
                {workCenters.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>Create Work Order</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function WorkOrdersPage() {
  const router = useRouter();
  const [wos, setWos] = useState<WorkOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [wcMap, setWcMap] = useState<Map<string, WorkCenter>>(new Map());

  const loadMeta = useCallback(async () => {
    try {
      const [itemRes, wcRes] = await Promise.all([listItems({ limit: 500 }), listWorkCenters()]);
      setItems(itemRes.items);
      setWorkCenters(wcRes);
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

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Work Orders" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New WO", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
        { id: "export", label: "Export CSV", variant: "ghost", onClick: exportCsv },
      ]} />

      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map(t => (
            <button key={t.value} onClick={() => setStatusFilter(t.value)}
              className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search WOs…" className="max-w-48 h-8 text-xs" />
        <span className="ml-auto text-xs text-ink-3">{total} orders</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading && !wos.length ? (
          <div className="flex h-32 items-center justify-center text-sm text-ink-3">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">WO Code</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Progress</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2">Work Center</th>
                <th className="px-4 py-2">Due</th>
                <th className="px-4 py-2">v</th>
              </tr>
            </thead>
            <tbody>
              {wos.map((wo) => {
                const item = itemMap.get(wo.itemId);
                const wc = wcMap.get(wo.workCenterId ?? "");
                const pct = wo.qty > 0 ? Math.min(100, Math.round((wo.qtyCompleted / wo.qty) * 100)) : 0;
                return (
                  <tr key={wo.id} onClick={() => router.push(`/mfg/work-orders/${wo.id}`)}
                    className="cursor-pointer border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-ink">{wo.code}</td>
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs text-ink">{item?.code ?? "—"}</div>
                      <div className="text-xs text-ink-3">{item?.name ?? ""}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{wo.qty}</td>
                    <td className="px-4 py-2">
                      <div className="text-xs font-mono text-ink-2">{wo.qtyCompleted}/{wo.qty}</div>
                      <div className="mt-1 h-1.5 w-20 rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-success transition-all" data-pct={pct} style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-2"><Tag tone={statusTone(wo.status)} dot>{wo.status.replace("_", " ")}</Tag></td>
                    <td className="px-4 py-2"><Tag tone={priorityTone(wo.priority)}>{wo.priority}</Tag></td>
                    <td className="px-4 py-2 text-xs text-ink-2">{wc?.code ?? "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink-3">{wo.dueDate ? new Date(wo.dueDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink-3">{wo.version}</td>
                  </tr>
                );
              })}
              {!loading && wos.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-ink-3">No work orders found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewWODialog items={items} workCenters={workCenters} onClose={() => setShowNew(false)} onCreated={(wo) => { setShowNew(false); router.push(`/mfg/work-orders/${wo.id}`); }} />
      )}
    </div>
  );
}
