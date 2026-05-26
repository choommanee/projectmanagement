"use client";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listIdentityUsers } from "@/lib/api/identity";

interface KpiTileProps { label: string; value: string | number }
function KpiTile({ label, value }: KpiTileProps) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-line bg-surface p-4">
      <span className="text-xs font-medium uppercase tracking-wider text-ink-3">{label}</span>
      <span className="font-mono text-3xl font-bold tabular-nums text-ink">{value}</span>
    </div>
  );
}

export default function AdminHomePage() {
  const [userCount, setUserCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listIdentityUsers()
      .then((u) => setUserCount(u.length))
      .catch(() => setUserCount(0))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Dashboard" }]} />
      <h1 className="text-xl font-semibold">Tenant Administration</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiTile label="Total Users" value={loading ? "…" : String(userCount ?? 0)} />
        <KpiTile label="Active Roles" value="7" />
        <KpiTile label="API Keys" value="—" />
        <KpiTile label="Audit Events (24h)" value="—" />
      </div>

      <div className="rounded-sm border border-line bg-surface p-4">
        <p className="text-sm text-ink-3">
          Manage users, roles, API keys, and tenant configuration from the left navigation.
        </p>
      </div>
    </div>
  );
}
