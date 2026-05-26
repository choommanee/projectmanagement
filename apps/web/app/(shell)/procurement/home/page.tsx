"use client";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listSuppliers, listPurchaseOrders } from "@/lib/api/mfg";
import { Tag } from "@pmplatform/ui-kit";

interface KpiTileProps {
  label: string;
  value: number | string;
  sub?: string;
}

function KpiTile({ label, value, sub }: KpiTileProps) {
  return (
    <div className="border border-line bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-widest text-ink-3">{label}</div>
      <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function statusTone(s: string): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "draft") return "neutral";
  if (s === "submitted") return "info";
  if (s === "approved") return "accent";
  if (s === "received") return "success";
  if (s === "cancelled") return "danger";
  return "neutral";
}

export default function ProcurementHomePage() {
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["procurement", "suppliers"],
    queryFn: () => listSuppliers(),
  });

  const { data: poDraft } = useQuery({
    queryKey: ["procurement", "po", "draft"],
    queryFn: () => listPurchaseOrders({ status: "draft", limit: 1 }),
  });

  const { data: poApproved } = useQuery({
    queryKey: ["procurement", "po", "approved"],
    queryFn: () => listPurchaseOrders({ status: "approved", limit: 1 }),
  });

  const { data: poAll } = useQuery({
    queryKey: ["procurement", "po", "all"],
    queryFn: () => listPurchaseOrders({ limit: 5 }),
  });

  const recentPos = poAll?.items ?? [];

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Procurement Hub", href: "/procurement/home" }, { label: "Dashboard" }]} />

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-base font-semibold text-ink">Procurement Dashboard</h1>
          <span className="font-mono text-xs text-ink-3">{today}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <KpiTile
            label="Total Suppliers"
            value={suppliers.length}
            sub="Registered vendor accounts"
          />
          <KpiTile
            label="Open Purchase Orders"
            value={poDraft?.total ?? 0}
            sub="Draft orders pending submission"
          />
          <KpiTile
            label="Confirmed Orders"
            value={poApproved?.total ?? 0}
            sub="Approved — awaiting receipt"
          />
          <KpiTile
            label="Total Purchase Orders"
            value={poAll?.total ?? 0}
            sub="All statuses combined"
          />
        </div>

        {/* Recent POs table */}
        <div className="mt-8">
          <div className="mb-2 text-xs font-medium uppercase tracking-widest text-ink-3">
            Recent Purchase Orders
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">PO Number</th>
                <th className="px-4 py-2">Supplier</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Order Date</th>
              </tr>
            </thead>
            <tbody>
              {recentPos.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-ink-3">
                    No purchase orders yet.
                  </td>
                </tr>
              ) : (
                recentPos.map((po) => (
                  <tr key={po.id} className="border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-ink">
                      {po.poNumber || po.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">{po.supplierId.slice(0, 8)}</td>
                    <td className="px-4 py-2">
                      <Tag tone={statusTone(po.status)}>{po.status}</Tag>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-2">
                      {po.orderDate ? new Date(po.orderDate).toLocaleDateString("en-GB") : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
