"use client";
import { DashboardGrid } from "@/primitives/dashboard/DashboardGrid";
import type { DashboardDef } from "@/primitives/dashboard/dashboard.types";

const def: DashboardDef = {
  id: "mfg-home", name: "MFG Home",
  widgets: [
    { id: "k1", kind: "kpi", x: 0, y: 0, w: 3, h: 2, config: { title: "Active WOs",      value: 6, delta: -1, sub: "vs yesterday", spark: [4,5,6,7,7,7,6] } },
    { id: "k2", kind: "kpi", x: 3, y: 0, w: 3, h: 2, config: { title: "Released Today",  value: 2, sub: "high priority", spark: [1,3,2,4,3,2,2] } },
    { id: "k3", kind: "kpi", x: 6, y: 0, w: 3, h: 2, config: { title: "OEE",             value: "78%", delta: 4, sub: "rolling 7d", spark: [70,72,73,75,76,77,78] } },
    { id: "k4", kind: "kpi", x: 9, y: 0, w: 3, h: 2, config: { title: "NCRs Open",       value: 3, delta: 1, sub: "needs CAPA", spark: [1,2,2,3,3,3,3] } },
    { id: "c1", kind: "chart",x: 0, y: 2, w: 8, h: 4, config: { title: "Production by Work Center (12 hrs)" } },
    { id: "l1", kind: "list", x: 8, y: 2, w: 4, h: 4, config: { title: "Quality Watch", items: [
      { label: "WC-WLD-03 — heat spike",    meta: "now" },
      { label: "Lot L-2026-441 quarantine", meta: "12m" },
      { label: "PPAP submission overdue",   meta: "1h" },
      { label: "Control plan rev pending",  meta: "3h" },
    ]}},
  ],
};

export default function Home() {
  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Dashboard</h1>
        <p className="mt-1 text-xl font-semibold text-ink">Manufacturing Home</p>
      </div>
      <DashboardGrid def={def} />
    </div>
  );
}
