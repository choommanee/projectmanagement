"use client";
import { DashboardGrid } from "@/primitives/dashboard/DashboardGrid";
import type { DashboardDef } from "@/primitives/dashboard/dashboard.types";

const def: DashboardDef = {
  id: "home", name: "Home",
  widgets: [
    { id: "k1", kind: "kpi",  x: 0, y: 0, w: 3, h: 2, config: { title: "Active Projects", value: 12 } },
    { id: "k2", kind: "kpi",  x: 3, y: 0, w: 3, h: 2, config: { title: "Open Tasks",      value: 87 } },
    { id: "l1", kind: "list", x: 0, y: 2, w: 6, h: 4, config: { title: "Recent Activity", items: [{ label: "Project Alpha created" }, { label: "WO-2026-00421 released" }] } },
  ],
};

export default function Home() {
  return <div className="p-4"><DashboardGrid def={def} /></div>;
}
