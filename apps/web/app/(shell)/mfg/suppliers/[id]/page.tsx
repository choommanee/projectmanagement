"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getSupplier, listPurchaseOrders,
  type Supplier, type PurchaseOrder, type POStatus,
} from "@/lib/api/mfg";

const PO_STATUS_COLORS: Record<POStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-indigo-100 text-indigo-700",
  received: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
};

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getSupplier(id).then(setSupplier),
      listPurchaseOrders({ limit: 50 }).then(r =>
        setOrders(r.items.filter(po => po.supplierId === id))
      ),
    ]).finally(() => setLoading(false));
  }, [id]);

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });
  const totalPOValue = orders.reduce((s, po) => s + po.lines.reduce((ls, l) => ls + l.qtyOrdered * l.unitPrice, 0), 0);
  const openOrders = orders.filter(po => po.status !== "received" && po.status !== "cancelled").length;

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!supplier) return <div className="p-6 text-sm text-red-600">Supplier not found</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "MFG" }, { label: "Suppliers", href: "/mfg/suppliers" }, { label: supplier.name }]} />

      <div className="rounded-lg border border-border bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold">{supplier.name}</h1>
            <span className="font-mono text-xs text-muted-foreground">{supplier.code}</span>
            {!supplier.active && <span className="px-2 py-0.5 rounded text-xs bg-zinc-100 text-zinc-500">Inactive</span>}
          </div>
          <div className="text-sm text-muted-foreground space-y-0.5">
            {supplier.contact && <div>{supplier.contact}</div>}
            {supplier.email && <div>{supplier.email}</div>}
            {supplier.phone && <div>{supplier.phone}</div>}
            <div className="text-xs">Lead time: {supplier.leadTimeDays} days</div>
          </div>
        </div>
        <button onClick={() => router.back()} className="text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded">← Back</button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Total POs</div>
          <div className="text-2xl font-mono font-bold">{orders.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Open POs</div>
          <div className="text-2xl font-mono font-bold text-amber-600">{openOrders}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Total PO Value</div>
          <div className="text-2xl font-mono font-bold">{fmt(totalPOValue)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 bg-muted/50 text-sm font-medium">Purchase Orders</div>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
            <tr>
              <th className="px-4 py-2 text-left font-medium">PO #</th>
              <th className="px-4 py-2 text-left font-medium">Order Date</th>
              <th className="px-4 py-2 text-left font-medium">Expected</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Lines</th>
              <th className="px-4 py-2 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No purchase orders</td></tr>}
            {orders.map(po => {
              const poVal = po.lines.reduce((s, l) => s + l.qtyOrdered * l.unitPrice, 0);
              return (
                <tr key={po.id} onClick={() => router.push(`/procurement/purchase-orders/${po.id}`)}
                  className="border-t border-border hover:bg-muted/20 cursor-pointer">
                  <td className="px-4 py-3 font-mono text-xs">{po.poNumber}</td>
                  <td className="px-4 py-3 text-xs">{po.orderDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs">{po.expectedDate?.slice(0, 10) ?? "—"}</td>
                  <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-xs ${PO_STATUS_COLORS[po.status as POStatus] ?? "bg-zinc-100 text-zinc-600"}`}>{po.status}</span></td>
                  <td className="px-4 py-3 text-right text-xs">{po.lines.length}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(poVal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
