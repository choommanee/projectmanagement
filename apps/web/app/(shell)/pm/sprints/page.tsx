"use client";
import { Breadcrumb } from "@/shell/Breadcrumb";
export default function Page() {
  return (
    <div>
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Sprints" }]} />
      <div className="p-6">
        <h1 className="text-xl font-semibold">Sprints</h1>
        <p className="mt-2 text-sm text-fgMuted">Sprint planning + burndown view — Phase 2 (Plan #5: PM UI).</p>
      </div>
    </div>
  );
}
