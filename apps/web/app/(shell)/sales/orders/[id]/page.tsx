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
  draft: "bg-surface-2 text-ink-3",
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

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!order) return <div className="p-6 text-sm text-red-600">Order not found</div>;

  const canAdvance = STATUS_FLOW.includes(order.status) && order.status !== "invoiced";

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Sales" }, { label: "Orders", href: "/sales/orders" }, { label: order.soNumber }]} />

      <div className="rounded-lg border border-line bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold font-mono">{order.soNumber}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[order.status]}`}>{order.status}</span>
          </div>
          <div className="text-sm text-ink-3 space-y-0.5">
            {customer && <div className="font-medium text-foreground">{customer.name} <span className="text-xs text-ink-3">({customer.code})</span></div>}
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
          <button onClick={() => router.back()} className="px-3 py-1.5 text-xs rounded border border-line text-ink-3 hover:text-ink">← Back</button>
        </div>
      </div>

      <div className="rounded-lg border border-line overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-surface-2">
          <span className="text-sm font-medium">Order Lines ({order.lines.length})</span>
          {order.status === "draft" && (
            <button onClick={() => setShowAddLine(true)} className="text-xs px-2 py-1 rounded bg-accent text-white hover:bg-accent/90">+ Add Line</button>
          )}
        </div>

        {showAddLine && (
          <div className="px-4 py-3 border-b border-line bg-surface-2 flex items-end gap-3">
            <div className="flex-1">
              <label className="text-xs text-ink-3">Description</label>
              <input value={lineDesc} onChange={e => setLineDesc(e.target.value)} placeholder="Item description"
                className="w-full mt-0.5 text-sm border border-line rounded px-2 py-1.5 bg-surface" />
            </div>
            <div className="w-20">
              <label className="text-xs text-ink-3">Qty</label>
              <input type="number" value={lineQty} onChange={e => setLineQty(e.target.value)} min="1"
                className="w-full mt-0.5 text-sm border border-line rounded px-2 py-1.5 bg-surface" />
            </div>
            <div className="w-28">
              <label className="text-xs text-ink-3">Unit Price</label>
              <input type="number" value={linePrice} onChange={e => setLinePrice(e.target.value)} placeholder="0"
                className="w-full mt-0.5 text-sm border border-line rounded px-2 py-1.5 bg-surface" />
            </div>
            <button onClick={handleAddLine} className="px-2 py-1.5 text-xs rounded bg-accent text-white">Add</button>
            <button onClick={() => setShowAddLine(false)} className="px-2 py-1.5 text-xs rounded border border-line">✕</button>
          </div>
        )}

        <table className="w-full text-sm">
          <thead className="text-xs text-ink-3 uppercase bg-surface-2">
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
            {order.lines.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-3">No lines — add one above</td></tr>}
            {order.lines.map(l => (
              <tr key={l.id} className="border-t border-line hover:bg-surface-2">
                <td className="px-4 py-3 text-xs text-ink-3">{l.lineNo}</td>
                <td className="px-4 py-3 text-xs">{l.itemDesc}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{l.qtyOrdered}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{l.qtyShipped}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{fmt(l.unitPrice)}</td>
                <td className="px-4 py-3 text-right font-mono text-xs font-semibold">{fmt(lineTotal(l))}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-line bg-surface-2">
              <td colSpan={5} className="px-4 py-2 text-right text-xs font-medium">Order Total</td>
              <td className="px-4 py-2 text-right font-mono text-sm font-bold">{fmt(orderTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
