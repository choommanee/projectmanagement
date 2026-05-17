"use client";
import { Breadcrumb } from "@/shell/Breadcrumb";
export default function Page() {
  return (
    <div>
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Workflows" }]} />
      <div className="p-6">
        <h1 className="text-xl font-semibold">Workflows</h1>
        <p className="mt-2 text-sm text-fgMuted">Workflow designer + trigger rules — Phase 2 (Plan #5: Admin UI).</p>
      </div>
    </div>
  );
}
