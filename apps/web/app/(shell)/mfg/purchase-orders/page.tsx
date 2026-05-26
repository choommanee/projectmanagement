"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listPurchaseOrders, createPurchaseOrder, updatePurchaseOrder, getPurchaseOrder,
  listSuppliers, listItems,
  addPOLine, updatePOLine, deletePOLine,
  type PurchaseOrder, type POLine, type POStatus, type Supplier, type Item,
} from "@/lib/api/mfg";

const PO_STATUSES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "Submitted" },
  { value: "approved", label: "Approved" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

function statusTone(s: string): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "draft") return "neutral";
  if (s === "submitted") return "info";
  if (s === "approved") return "accent";
  if (s === "received") return "success";
  if (s === "cancelled") return "danger";
  return "neutral";
}

// ─── New PO Dialog ──────────────────────────────────────────────────────────

function NewPODialog({
  open, suppliers, onClose, onCreated,
}: {
  open: boolean;
  suppliers: Supplier[];
  onClose: () => void;
  onCreated: (po: PurchaseOrder) => void;
}) {
  const [form, setForm] = useState({ supplier_id: "", order_date: new Date().toISOString().split("T")[0], expected_date: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ supplier_id: suppliers[0]?.id ?? "", order_date: new Date().toISOString().split("T")[0], expected_date: "", notes: "" });
      setError(null);
    }
  }, [open, suppliers]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.supplier_id) { setError("Supplier is required."); return; }
    setLoading(true);
    setError(null);
    try {
      const po = await createPurchaseOrder({
        supplier_id: form.supplier_id,
        order_date: form.order_date || undefined,
        expected_date: form.expected_date || undefined,
        notes: form.notes,
      });
      onCreated(po);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create PO");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New Purchase Order"
      description="Create a draft purchase order for a supplier"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>Create PO</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Supplier *</label>
          <select
            value={form.supplier_id}
            onChange={(e) => setForm(f => ({ ...f, supplier_id: e.target.value }))}
            className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
          >
            <option value="">— select supplier —</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Order Date</label>
            <Input type="date" value={form.order_date} onChange={(e) => setForm(f => ({ ...f, order_date: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Expected Date</label>
            <Input type="date" value={form.expected_date} onChange={(e) => setForm(f => ({ ...f, expected_date: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Notes</label>
          <Input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
        </div>
      </form>
    </Dialog>
  );
}

// ─── Add Line Row ──────────────────────────────────────────────────────────

function AddLineRow({
  poId, items, onAdded,
}: {
  poId: string;
  items: Item[];
  onAdded: (line: POLine) => void;
}) {
  const [form, setForm] = useState({ item_id: "", qty_ordered: "1", unit_price: "0", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!form.item_id) { setError("Item required"); return; }
    setLoading(true);
    setError(null);
    try {
      const line = await addPOLine(poId, {
        item_id: form.item_id,
        qty_ordered: Number(form.qty_ordered) || 1,
        unit_price: Number(form.unit_price) || 0,
        notes: form.notes,
      });
      onAdded(line);
      setForm({ item_id: "", qty_ordered: "1", unit_price: "0", notes: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add line");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <tr className="border-b border-line bg-surface-2/50">
        <td className="px-3 py-1 text-xs text-ink-3">new</td>
        <td className="px-3 py-1">
          <select
            value={form.item_id}
            onChange={(e) => setForm(f => ({ ...f, item_id: e.target.value }))}
            className="h-7 w-full rounded-xs border border-line bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none"
          >
            <option value="">— search item —</option>
            {items.map(i => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
          </select>
        </td>
        <td className="px-3 py-1">
          <input
            type="number"
            min="0"
            step="0.001"
            value={form.qty_ordered}
            onChange={(e) => setForm(f => ({ ...f, qty_ordered: e.target.value }))}
            className="h-7 w-24 rounded-xs border border-line bg-surface px-2 text-right font-mono text-xs text-ink focus:border-accent focus:outline-none"
          />
        </td>
        <td className="px-3 py-1 text-xs text-ink-3">—</td>
        <td className="px-3 py-1">
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.unit_price}
            onChange={(e) => setForm(f => ({ ...f, unit_price: e.target.value }))}
            className="h-7 w-28 rounded-xs border border-line bg-surface px-2 text-right font-mono text-xs text-ink focus:border-accent focus:outline-none"
          />
        </td>
        <td className="px-3 py-1">
          <input
            value={form.notes}
            onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Notes"
            className="h-7 w-full rounded-xs border border-line bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none"
          />
        </td>
        <td className="px-3 py-1">
          <button
            onClick={() => void add()}
            disabled={loading}
            className="rounded-xs bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {loading ? "..." : "Add"}
          </button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="px-3 py-1 text-xs text-danger">{error}</td>
        </tr>
      )}
    </>
  );
}

// ─── PO Detail Panel ──────────────────────────────────────────────────────────

function PODetail({
  po: initialPo, supplierMap, items, onStatusChanged,
}: {
  po: PurchaseOrder;
  supplierMap: Map<string, Supplier>;
  items: Item[];
  onStatusChanged: (po: PurchaseOrder) => void;
}) {
  const [po, setPo] = useState(initialPo);
  const [addingLine, setAddingLine] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setPo(initialPo); }, [initialPo]);

  const supplier = supplierMap.get(po.supplierId);

  async function changeStatus(newStatus: POStatus) {
    setStatusLoading(true);
    setError(null);
    try {
      const updated = await updatePurchaseOrder(po.id, { status: newStatus });
      setPo(updated);
      onStatusChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setStatusLoading(false);
    }
  }

  async function removeLine(lineId: string) {
    try {
      await deletePOLine(po.id, lineId);
      setPo(prev => ({ ...prev, lines: prev.lines.filter(l => l.id !== lineId) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete line");
    }
  }

  const total = po.lines.reduce((sum, l) => sum + l.qtyOrdered * l.unitPrice, 0);

  return (
    <div className="flex flex-col gap-0 overflow-auto">
      {/* Header */}
      <div className="border-b border-line bg-surface-2 px-4 py-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-ink">{po.poNumber || po.id.slice(0, 8)}</span>
              <Tag tone={statusTone(po.status)}>{po.status}</Tag>
            </div>
            <div className="mt-1 text-xs text-ink-2">
              {supplier ? `${supplier.code} — ${supplier.name}` : po.supplierId}
            </div>
          </div>
          <div className="flex gap-1">
            {po.status === "draft" && (
              <button
                onClick={() => void changeStatus("submitted")}
                disabled={statusLoading}
                className="rounded-xs border border-accent px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
              >
                Submit
              </button>
            )}
            {po.status === "submitted" && (
              <button
                onClick={() => void changeStatus("approved")}
                disabled={statusLoading}
                className="rounded-xs border border-success px-3 py-1 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50"
              >
                Approve
              </button>
            )}
            {po.status === "approved" && (
              <button
                onClick={() => void changeStatus("received")}
                disabled={statusLoading}
                className="rounded-xs border border-success px-3 py-1 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-50"
              >
                Mark Received
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-4 text-xs">
          <div>
            <span className="text-ink-3">Order Date</span>
            <div className="font-mono text-ink">{po.orderDate ? new Date(po.orderDate).toLocaleDateString() : "—"}</div>
          </div>
          <div>
            <span className="text-ink-3">Expected</span>
            <div className="font-mono text-ink">{po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : "—"}</div>
          </div>
          <div>
            <span className="text-ink-3">Total</span>
            <div className="font-mono font-semibold text-ink">{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </div>
        {po.notes && <p className="mt-2 text-xs text-ink-2">{po.notes}</p>}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>

      {/* Lines */}
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-between px-4 py-2 text-xs font-medium text-ink-3">
          <span>Lines ({po.lines.length})</span>
          {po.status === "draft" && (
            <button
              onClick={() => setAddingLine(a => !a)}
              className="rounded-xs px-2 py-1 text-xs text-accent hover:bg-accent/10"
            >
              {addingLine ? "Cancel" : "+ Add Line"}
            </button>
          )}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Qty Ordered</th>
              <th className="px-3 py-2 text-right">Qty Received</th>
              <th className="px-3 py-2 text-right">Unit Price</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => {
              const item = items.find(i => i.id === l.itemId);
              return (
                <tr key={l.id} className="border-b border-line hover:bg-surface-2">
                  <td className="px-3 py-2 font-mono text-ink-3">{l.lineNo}</td>
                  <td className="px-3 py-2 font-mono text-ink">{item ? `${item.code}` : l.itemId.slice(0, 8)}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink">{l.qtyOrdered.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink-2">{l.qtyReceived.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-ink">{l.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2 text-ink-2">{l.notes || "—"}</td>
                  <td className="px-3 py-2">
                    {po.status === "draft" && (
                      <button
                        onClick={() => void removeLine(l.id)}
                        className="text-ink-3 hover:text-danger"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {addingLine && (
              <AddLineRow
                poId={po.id}
                items={items}
                onAdded={(line) => {
                  setPo(prev => ({ ...prev, lines: [...prev.lines, line] }));
                  setAddingLine(false);
                }}
              />
            )}
            {po.lines.length === 0 && !addingLine && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-ink-3">
                  No lines yet. Click "+ Add Line" to begin.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PurchaseOrdersPage() {
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [supplierMap, setSupplierMap] = useState<Map<string, Supplier>>(new Map());
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newPoOpen, setNewPoOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, supList, itemRes] = await Promise.all([
        listPurchaseOrders({ status: statusFilter, limit: 100 }),
        suppliers.length === 0 ? listSuppliers() : Promise.resolve(suppliers),
        items.length === 0 ? listItems({ limit: 200 }) : Promise.resolve({ items, total: 0 }),
      ]);
      setPos(res.items);
      setTotal(res.total);
      if (suppliers.length === 0) {
        setSuppliers(supList);
        setSupplierMap(new Map(supList.map(s => [s.id, s])));
      }
      if (items.length === 0) {
        setItems(itemRes.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load purchase orders");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, suppliers, items]);

  useEffect(() => { void load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSelectPO(po: PurchaseOrder) {
    // Reload full PO (with lines) when selecting
    try {
      const full = await getPurchaseOrder(po.id);
      setSelected(full);
    } catch {
      setSelected(po);
    }
  }

  function handleCreated(po: PurchaseOrder) {
    setNewPoOpen(false);
    setPos(prev => [po, ...prev]);
    void handleSelectPO(po);
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Purchase Orders" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New PO", variant: "primary", onClick: () => setNewPoOpen(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      {/* Status filter bar */}
      <div className="flex items-center gap-1 border-b border-line bg-paper px-4 py-2">
        {PO_STATUSES.map(t => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-3">{total} orders</span>
      </div>

      {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {/* List + Detail split */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: PO list */}
        <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-line">
          {loading && !pos.length ? (
            <div className="space-y-px">
              {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 animate-pulse border-b border-line bg-surface-2" />)}
            </div>
          ) : (
            <ul>
              {pos.map((po) => {
                const sup = supplierMap.get(po.supplierId);
                return (
                  <li
                    key={po.id}
                    onClick={() => void handleSelectPO(po)}
                    className={`cursor-pointer border-b border-line px-3 py-3 hover:bg-surface-2 ${selected?.id === po.id ? "bg-accent/5 border-l-2 border-l-accent" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-ink">
                        {po.poNumber || po.id.slice(0, 8)}
                      </span>
                      <Tag tone={statusTone(po.status)}>{po.status}</Tag>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-2 truncate">
                      {sup ? `${sup.code} — ${sup.name}` : "—"}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      {po.orderDate ? new Date(po.orderDate).toLocaleDateString() : "—"}
                    </div>
                  </li>
                );
              })}
              {!loading && pos.length === 0 && (
                <li className="px-4 py-8 text-center text-xs text-ink-3">No purchase orders.</li>
              )}
            </ul>
          )}
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-auto">
          {selected ? (
            <PODetail
              po={selected}
              supplierMap={supplierMap}
              items={items}
              onStatusChanged={(updated) => {
                setSelected(updated);
                setPos(prev => {
                  const idx = prev.findIndex(p => p.id === updated.id);
                  if (idx >= 0) { const n = [...prev]; n[idx] = updated; return n; }
                  return prev;
                });
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-3">
              Select a purchase order to view details
            </div>
          )}
        </div>
      </div>

      <NewPODialog
        open={newPoOpen}
        suppliers={suppliers}
        onClose={() => setNewPoOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
