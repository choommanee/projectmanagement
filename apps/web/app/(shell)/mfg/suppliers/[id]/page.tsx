"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getSupplier, listPurchaseOrders,
  type Supplier, type PurchaseOrder, type POStatus,
} from "@/lib/api/mfg";

const PO_STATUS_COLORS: Record<POStatus, string> = {
  draft:     "bg-surface-2 text-ink-3",
  submitted: "bg-accent/10 text-accent",
  approved:  "bg-info/10 text-info",
  received:  "bg-success/10 text-success",
  cancelled: "bg-danger/10 text-danger",
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
      listPurchaseOrders({ limit: 100 }).then(r =>
        setOrders(r.items.filter(po => po.supplierId === id))
      ),
    ]).finally(() => setLoading(false));
  }, [id]);

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });
  const totalPOValue = orders.reduce((s, po) =>
    s + po.lines.reduce((ls, l) => ls + l.qtyOrdered * l.unitPrice, 0), 0
  );
  const openOrders = orders.filter(po => po.status !== "received" && po.status !== "cancelled").length;

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!supplier) return <div className="p-6 text-sm text-danger">Supplier not found</div>;

  return (
    <div className="flex h-full flex-col overflow-auto p-6 space-y-5">
      <Breadcrumb items={[
        { label: "MFG" },
        { label: "Suppliers", href: "/mfg/suppliers" },
        { label: supplier.name },
      ]} />

      {/* Header */}
      <div className="rounded-md border border-line bg-paper p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold text-ink">{supplier.name}</h1>
            <span className="font-mono text-xs text-ink-3">{supplier.code}</span>
            {!supplier.active && (
              <span className="rounded bg-surface-2 px-2 py-0.5 text-xs text-ink-3">Inactive</span>
            )}
          </div>
          <div className="space-y-0.5 text-sm text-ink-2">
            {supplier.contact && <div>{supplier.contact}</div>}
            {supplier.email && <div>{supplier.email}</div>}
            {supplier.phone && <div>{supplier.phone}</div>}
            <div className="text-xs text-ink-3">Lead time: {supplier.leadTimeDays} days</div>
          </div>
        </div>
        <button
          onClick={() => router.back()}
          className="rounded border border-line px-3 py-1.5 text-xs text-ink-3 hover:text-ink"
        >
          ← Back
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total POs", value: String(orders.length), tone: "" },
          { label: "Open POs", value: String(openOrders), tone: openOrders > 0 ? "text-warning" : "" },
          { label: "Total PO Value", value: fmt(totalPOValue), tone: "" },
        ].map(({ label, value, tone }) => (
          <div key={label} className="rounded-md border border-line bg-paper p-4">
            <p className="text-[10px] uppercase tracking-widest text-ink-3">{label}</p>
            <p className={`mt-1 font-mono text-2xl font-bold ${tone || "text-ink"}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Purchase Orders table */}
      <div className="rounded-md border border-line overflow-hidden">
        <div className="border-b border-line bg-surface-2 px-4 py-3">
          <span className="text-sm font-medium text-ink">Purchase Orders ({orders.length})</span>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs font-medium uppercase tracking-wide text-ink-3">
            <tr>
              <th className="px-4 py-2 text-left">PO #</th>
              <th className="px-4 py-2 text-left">Order Date</th>
              <th className="px-4 py-2 text-left">Expected</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Lines</th>
              <th className="px-4 py-2 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-ink-3">No purchase orders</td></tr>
            )}
            {orders.map(po => {
              const poVal = po.lines.reduce((s, l) => s + l.qtyOrdered * l.unitPrice, 0);
              return (
                <tr
                  key={po.id}
                  onClick={() => router.push(`/procurement/purchase-orders/${po.id}`)}
                  className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
                >
                  <td className="px-4 py-3 font-mono text-xs text-ink">{po.poNumber}</td>
                  <td className="px-4 py-3 text-xs text-ink-2">{po.orderDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs text-ink-2">{po.expectedDate?.slice(0, 10) ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${PO_STATUS_COLORS[po.status as POStatus] ?? "bg-surface-2 text-ink-3"}`}>
                      {po.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-ink-2">{po.lines.length}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-ink">{fmt(poVal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
