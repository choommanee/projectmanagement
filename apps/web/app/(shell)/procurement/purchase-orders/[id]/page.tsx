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
  draft:     "bg-surface-2 text-ink-3",
  submitted: "bg-accent/10 text-accent",
  approved:  "bg-info/10 text-info",
  received:  "bg-success/10 text-success",
  cancelled: "bg-danger/10 text-danger",
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
    getPurchaseOrder(id).then(po => {
      setOrder(po);
      return listSuppliers().then(all => {
        setSupplier(all.find(s => s.id === po.supplierId) ?? null);
      }).catch(() => null);
    }).finally(() => setLoading(false));
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

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!order) return <div className="p-6 text-sm text-danger">Purchase order not found</div>;

  const orderStatus = order.status as POStatus;
  const canAdvance = STATUS_FLOW.includes(orderStatus) && orderStatus !== "received";

  return (
    <div className="flex h-full flex-col overflow-auto p-6 space-y-5">
      <Breadcrumb items={[
        { label: "Procurement" },
        { label: "Purchase Orders", href: "/procurement/purchase-orders" },
        { label: order.poNumber },
      ]} />

      {/* Header */}
      <div className="rounded-md border border-line bg-paper p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold font-mono text-ink">{order.poNumber}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[orderStatus] ?? "bg-surface-2 text-ink-3"}`}>
              {order.status}
            </span>
          </div>
          <div className="text-sm text-ink-2 space-y-0.5">
            {supplier && (
              <div className="font-medium text-ink">
                {supplier.name} <span className="text-xs text-ink-3">({supplier.code})</span>
              </div>
            )}
            <div>Order date: {order.orderDate?.slice(0, 10)}</div>
            {order.expectedDate && <div>Expected: {order.expectedDate.slice(0, 10)}</div>}
            {order.notes && <div className="text-xs mt-1 text-ink-3">{order.notes}</div>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {canAdvance && (
            <button
              onClick={advance}
              disabled={saving}
              className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              → {STATUS_FLOW[STATUS_FLOW.indexOf(orderStatus) + 1]}
            </button>
          )}
          {order.status === "draft" && (
            <button
              onClick={cancel}
              disabled={saving}
              className="rounded border border-danger/40 px-3 py-1.5 text-xs text-danger hover:bg-danger/5 disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => router.back()}
            className="rounded border border-line px-3 py-1.5 text-xs text-ink-3 hover:text-ink"
          >
            ← Back
          </button>
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-md border border-line overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-surface-2">
          <span className="text-sm font-medium text-ink">PO Lines ({order.lines.length})</span>
          {order.status === "draft" && (
            <button
              onClick={() => setShowAddLine(true)}
              className="rounded bg-accent px-2 py-1 text-xs font-semibold text-white hover:opacity-90"
            >
              + Add Line
            </button>
          )}
        </div>

        {showAddLine && (
          <div className="px-4 py-3 border-b border-line bg-surface flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs text-ink-3">Item ID / SKU</label>
              <input
                value={lineItemId}
                onChange={e => setLineItemId(e.target.value)}
                placeholder="Item ID"
                className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-ink-3">Qty</label>
              <input
                type="number"
                value={lineQty}
                onChange={e => setLineQty(e.target.value)}
                min="1"
                className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              />
            </div>
            <div className="w-28">
              <label className="text-xs text-ink-3">Unit Price</label>
              <input
                type="number"
                value={linePrice}
                onChange={e => setLinePrice(e.target.value)}
                placeholder="0"
                className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              />
            </div>
            <button onClick={handleAddLine} className="rounded bg-accent px-2 py-1.5 text-xs text-white">Add</button>
            <button onClick={() => setShowAddLine(false)} className="rounded border border-line px-2 py-1.5 text-xs text-ink-3 hover:text-ink">✕</button>
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs font-medium uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-4 py-2 text-left">#</th>
              <th className="px-4 py-2 text-left">Item ID</th>
              <th className="px-4 py-2 text-right">Qty Ordered</th>
              <th className="px-4 py-2 text-right">Qty Received</th>
              <th className="px-4 py-2 text-center">Receipt %</th>
              <th className="px-4 py-2 text-right">Unit Price</th>
              <th className="px-4 py-2 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-xs text-ink-3">No lines — add one above</td></tr>
            )}
            {order.lines.map(l => {
              const pct = l.qtyOrdered > 0 ? Math.round((l.qtyReceived / l.qtyOrdered) * 100) : 0;
              return (
                <tr key={l.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3 text-xs text-ink-3">{l.lineNo}</td>
                  <td className="px-4 py-3 font-mono text-xs text-ink">{l.itemId}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-ink">{l.qtyOrdered}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-ink">{l.qtyReceived}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                        {/* eslint-disable-next-line react/forbid-dom-props */}
                        <div
                          className={`h-full rounded-full ${pct === 100 ? "bg-success" : pct > 0 ? "bg-warning" : "bg-ink-3/20"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right font-mono text-xs text-ink-3">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-ink">{fmt(l.unitPrice)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-ink">{fmt(lineTotal(l))}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-line bg-surface-2">
              <td colSpan={6} className="px-4 py-2 text-right text-xs font-semibold text-ink-2">PO Total</td>
              <td className="px-4 py-2 text-right font-mono text-sm font-bold text-ink">{fmt(orderTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
