"use client";
import { useState, useEffect } from "react";
import { DashboardGrid } from "@/primitives/dashboard/DashboardGrid";
import type { DashboardDef } from "@/primitives/dashboard/dashboard.types";
import { listWorkOrders, type WorkOrder } from "@/lib/api/mfg";
import { listNCRs } from "@/lib/api/quality";

function relTime(iso: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "<1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function MfgHome() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [openNcrs, setOpenNcrs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      listWorkOrders({ limit: 200 }),
      listWorkOrders({ status: "completed", limit: 200 }),
      listNCRs({ status: "open", limit: 200 }).catch(() => null),
    ])
      .then(([all, completed, ncrs]) => {
        setWorkOrders(all.items);
        setCompletedCount(completed.total);
        setOpenNcrs(ncrs ? ncrs.length : null);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const activeWOs = workOrders.filter(
    wo => wo.status === "in_progress" || wo.status === "released",
  );
  const releasedWOs = workOrders.filter(wo => wo.status === "released");
  const recent5 = [...workOrders]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const def: DashboardDef = {
    id: "mfg-home",
    name: "MFG Home",
    widgets: [
      {
        id: "k1", kind: "kpi", x: 0, y: 0, w: 3, h: 2,
        config: { title: "Active WOs", value: activeWOs.length, sub: "in progress + released", spark: Array(7).fill(activeWOs.length) },
      },
      {
        id: "k2", kind: "kpi", x: 3, y: 0, w: 3, h: 2,
        config: { title: "Released", value: releasedWOs.length, sub: "awaiting production", spark: Array(7).fill(releasedWOs.length) },
      },
      {
        id: "k3", kind: "kpi", x: 6, y: 0, w: 3, h: 2,
        config: { title: "Completed", value: completedCount, sub: "work orders", spark: Array(7).fill(completedCount) },
      },
      {
        id: "k4", kind: "kpi", x: 9, y: 0, w: 3, h: 2,
        config: { title: "Open NCRs", value: openNcrs !== null ? openNcrs : "—", sub: "needs CAPA", spark: openNcrs !== null ? Array(7).fill(openNcrs) : Array(7).fill(0) },
      },
      {
        id: "c1", kind: "chart", x: 0, y: 2, w: 8, h: 4,
        config: { title: "Production by Work Center" },
      },
      {
        id: "l1", kind: "list", x: 8, y: 2, w: 4, h: 4,
        config: {
          title: "Recent Work Orders",
          items: recent5.map(wo => ({ label: wo.code, meta: `${wo.status} · ${relTime(wo.updatedAt)}` })),
        },
      },
    ],
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Dashboard</h1>
        <p className="mt-1 text-xl font-semibold text-ink">Manufacturing Home</p>
      </div>
      {error && (
        <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
          {error}
        </div>
      )}
      {loading ? (
        <div className="font-mono text-[11px] text-ink-3">Loading dashboard…</div>
      ) : (
        <DashboardGrid def={def} />
      )}
    </div>
  );
}
