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

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!order) return <div className="p-6 text-sm text-red-600">Purchase order not found</div>;

  const orderStatus = order.status as POStatus;
  const canAdvance = STATUS_FLOW.includes(orderStatus) && orderStatus !== "received";

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Procurement" }, { label: "Purchase Orders", href: "/procurement/purchase-orders" }, { label: order.poNumber }]} />

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
