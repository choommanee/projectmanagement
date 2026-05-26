"use client";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";
import { listCustomers, listSalesOrders, type SalesOrder } from "@/lib/api/sales";

interface KPITileProps {
  label: string;
  value: number | null;
  loading: boolean;
}

function KPITile({ label, value, loading }: KPITileProps) {
  return (
    <div className="bg-surface border border-line p-4">
      <div className="text-xs text-ink-3 uppercase tracking-wide">{label}</div>
      {loading ? (
        <div className="mt-2 h-9 w-20 animate-pulse rounded-xs bg-surface-2" />
      ) : (
        <div className="mt-1 font-mono text-3xl font-semibold text-ink">
          {value ?? "—"}
        </div>
      )}
    </div>
  );
}

function statusTone(s: string): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "draft") return "neutral";
  if (s === "confirmed") return "info";
  if (s === "shipped") return "accent";
  if (s === "invoiced") return "success";
  if (s === "cancelled") return "danger";
  return "neutral";
}

interface KPIs {
  totalCustomers: number | null;
  totalOrders: number | null;
  draftOrders: number | null;
  confirmedOrders: number | null;
}

export default function SalesDashboardPage() {
  const [kpis, setKpis] = useState<KPIs>({
    totalCustomers: null,
    totalOrders: null,
    draftOrders: null,
    confirmedOrders: null,
  });
  const [kpiLoading, setKpiLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState<SalesOrder[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadKPIs() {
      setKpiLoading(true);
      try {
        const [custRes, allRes, draftRes, confirmedRes] = await Promise.all([
          listCustomers(),
          listSalesOrders({ limit: 1 }),
          listSalesOrders({ status: "draft", limit: 1 }),
          listSalesOrders({ status: "confirmed", limit: 1 }),
        ]);
        setKpis({
          totalCustomers: custRes.length,
          totalOrders: allRes.total,
          draftOrders: draftRes.total,
          confirmedOrders: confirmedRes.total,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load KPIs");
      } finally {
        setKpiLoading(false);
      }
    }

    async function loadRecent() {
      setRecentLoading(true);
      try {
        const res = await listSalesOrders({ limit: 5 });
        setRecentOrders(res.items);
      } catch {
        // non-fatal — KPI error already shown
      } finally {
        setRecentLoading(false);
      }
    }

    void loadKPIs();
    void loadRecent();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Sales Hub", href: "/sales/home" }, { label: "Dashboard" }]} />

      <div className="flex-1 overflow-auto p-6">
        <h1 className="mb-4 text-sm font-semibold uppercase tracking-widest text-ink-3">
          Sales Dashboard
        </h1>

        {error && (
          <div className="mb-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        )}

        {/* KPI Grid */}
        <div className="mb-6 grid grid-cols-2 gap-px border border-line bg-line">
          <KPITile label="Total Customers"   value={kpis.totalCustomers}   loading={kpiLoading} />
          <KPITile label="Total Orders"      value={kpis.totalOrders}      loading={kpiLoading} />
          <KPITile label="Draft Orders"      value={kpis.draftOrders}      loading={kpiLoading} />
          <KPITile label="Confirmed Orders"  value={kpis.confirmedOrders}  loading={kpiLoading} />
        </div>

        {/* Recent Orders */}
        <div className="border border-line">
          <div className="border-b border-line bg-surface-2 px-4 py-2 text-xs font-medium uppercase tracking-widest text-ink-3">
            Recent Orders
          </div>
          {recentLoading ? (
            <div className="space-y-px">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
              ))}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                  <th className="px-4 py-2">Order #</th>
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Total</th>
                  <th className="px-4 py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((so) => {
                  const total = so.lines.reduce((sum, l) => sum + l.qtyOrdered * l.unitPrice, 0);
                  return (
                    <tr key={so.id} className="border-b border-line hover:bg-surface-2">
                      <td className="px-4 py-2 font-mono text-xs text-ink">
                        {so.soNumber || so.id.slice(0, 8)}
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-2">{so.customerId}</td>
                      <td className="px-4 py-2">
                        <Tag tone={statusTone(so.status)}>{so.status}</Tag>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-ink">
                        {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-2">
                        {so.orderDate ? new Date(so.orderDate).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  );
                })}
                {!recentLoading && recentOrders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-xs text-ink-3">
                      No orders yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
