"use client";
import { Breadcrumb } from "@/shell/Breadcrumb";
export default function Page() {
  return (
    <div>
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Traceability" }]} />
      <div className="p-6">
        <h1 className="text-xl font-semibold">Traceability</h1>
        <p className="mt-2 text-sm text-fgMuted">Lot/serial traceability genealogy graph — Phase 2 (Plan #6: MFG UI).</p>
      </div>
    </div>
  );
}
