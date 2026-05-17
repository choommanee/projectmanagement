"use client";
import { Breadcrumb } from "@/shell/Breadcrumb";
export default function Page() {
  return (
    <div>
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Tenants" }]} />
      <div className="p-6">
        <h1 className="text-xl font-semibold">Tenants</h1>
        <p className="mt-2 text-sm text-fgMuted">Tenant management (backed by tenant-svc :8081) — Phase 2 (Plan #5: Admin UI).</p>
      </div>
    </div>
  );
}
