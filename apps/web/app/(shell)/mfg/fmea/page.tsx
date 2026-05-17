"use client";
import { Breadcrumb } from "@/shell/Breadcrumb";
export default function Page() {
  return (
    <div>
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "FMEA" }]} />
      <div className="p-6">
        <h1 className="text-xl font-semibold">FMEA</h1>
        <p className="mt-2 text-sm text-fgMuted">Failure Mode & Effects Analysis — Phase 2 (Plan #6: IATF 16949 Quality UI).</p>
      </div>
    </div>
  );
}
