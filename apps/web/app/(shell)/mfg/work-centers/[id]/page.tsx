"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { getWorkCenter, listWorkOrders, type WorkCenter, type WorkOrder, type WOStatus } from "@/lib/api/mfg";

const WO_STATUS_COLORS: Record<WOStatus, string> = {
  planned: "bg-zinc-100 text-zinc-600",
  draft: "bg-zinc-100 text-zinc-600",
  released: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-600",
  closed: "bg-zinc-200 text-zinc-500",
  on_hold: "bg-zinc-200 text-zinc-500",
} as Record<WOStatus, string>;

export default function WorkCenterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [wc, setWc] = useState<WorkCenter | null>(null);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getWorkCenter(id).then(setWc),
      listWorkOrders({ limit: 50 }).then(r =>
        setWorkOrders(r.items.filter(wo => wo.workCenterId === id))
      ),
    ]).finally(() => setLoading(false));
  }, [id]);

  const activeWOs = workOrders.filter(wo => wo.status === "released" || wo.status === "in_progress");
  const completedWOs = workOrders.filter(wo => wo.status === "completed");
  const weeklyCapacity = wc ? wc.capacityPerDayHrs * 5 : 0;

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!wc) return <div className="p-6 text-sm text-red-600">Work center not found</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "MFG" }, { label: "Work Centers", href: "/mfg/work-centers" }, { label: wc.name }]} />

      {/* Header */}
      <div className="rounded-lg border border-border bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold">{wc.name}</h1>
            <span className="font-mono text-xs text-muted-foreground">{wc.code}</span>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${wc.status === "active" ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>{wc.status}</span>
          </div>
          <div className="text-sm text-muted-foreground space-y-0.5">
            <div>Type: <span className="text-foreground capitalize">{wc.type}</span></div>
            <div>Capacity: <span className="font-mono text-foreground">{wc.capacityPerDayHrs} hrs/day</span></div>
            <div>Machines: <span className="font-mono text-foreground">{wc.machineCount}</span></div>
          </div>
        </div>
        <button onClick={() => router.back()} className="text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded">← Back</button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Daily Capacity</div>
          <div className="text-2xl font-mono font-bold">{wc.capacityPerDayHrs}h</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Weekly Capacity</div>
          <div className="text-2xl font-mono font-bold">{weeklyCapacity}h</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Active WOs</div>
          <div className="text-2xl font-mono font-bold text-amber-600">{activeWOs.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Completed WOs</div>
          <div className="text-2xl font-mono font-bold text-green-600">{completedWOs.length}</div>
        </div>
      </div>

      {/* Work Orders */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-3 bg-muted/50 text-sm font-medium">Work Orders ({workOrders.length})</div>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground uppercase bg-muted/30">
            <tr>
              <th className="px-4 py-2 text-left font-medium">WO #</th>
              <th className="px-4 py-2 text-left font-medium">Item</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Start</th>
              <th className="px-4 py-2 text-left font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {workOrders.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No work orders assigned</td></tr>}
            {workOrders.map(wo => (
              <tr key={wo.id} onClick={() => router.push(`/mfg/work-orders/${wo.id}`)}
                className="border-t border-border hover:bg-muted/20 cursor-pointer">
                <td className="px-4 py-3 font-mono text-xs">{wo.code}</td>
                <td className="px-4 py-3 font-mono text-xs">{wo.itemId}</td>
                <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-xs ${WO_STATUS_COLORS[wo.status] ?? ""}`}>{wo.status}</span></td>
                <td className="px-4 py-3 text-xs">{wo.startAt?.slice(0, 10) ?? "—"}</td>
                <td className="px-4 py-3 text-xs">{wo.dueDate?.slice(0, 10) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
