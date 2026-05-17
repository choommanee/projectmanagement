"use client";
import { DashboardGrid } from "@/primitives/dashboard/DashboardGrid";
import type { DashboardDef } from "@/primitives/dashboard/dashboard.types";

const def: DashboardDef = {
  id: "pm-home", name: "PM Home",
  widgets: [
    { id: "k1", kind: "kpi",  x: 0, y: 0, w: 3, h: 2, config: { title: "Active Projects",  value: 12, delta: 2,  sub: "vs last week", spark: [8,9,10,11,10,12,12] } },
    { id: "k2", kind: "kpi",  x: 3, y: 0, w: 3, h: 2, config: { title: "Open Tasks",       value: 87, delta: -5, sub: "vs last week", spark: [92,90,89,91,88,87,87] } },
    { id: "k3", kind: "kpi",  x: 6, y: 0, w: 3, h: 2, config: { title: "Sprint Velocity",  value: "34 pts", delta: 4, sub: "story points", spark: [28,30,32,30,33,34,34] } },
    { id: "k4", kind: "kpi",  x: 9, y: 0, w: 3, h: 2, config: { title: "On-Time %",        value: "92%", delta: 3, sub: "deliveries", spark: [86,87,88,89,90,91,92] } },
    { id: "c1", kind: "chart",x: 0, y: 2, w: 8, h: 4, config: { title: "Throughput (last 14d)" } },
    { id: "l1", kind: "list", x: 8, y: 2, w: 4, h: 4, config: { title: "Recent Activity", items: [
      { label: "Project Phoenix Migration", meta: "5m" },
      { label: "WO-2026-00421 released",    meta: "1h" },
      { label: "Sprint 12 closed",           meta: "3h" },
      { label: "BRD-103 approved",           meta: "6h" },
      { label: "T-1005 reassigned",          meta: "1d" },
    ]}},
  ],
};

export default function Home() {
  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Dashboard</h1>
        <p className="mt-1 text-xl font-semibold text-ink">PM Home</p>
      </div>
      <DashboardGrid def={def} />
    </div>
  );
}
