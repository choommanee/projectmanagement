"use client";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listEmployees, listDepartments, listPositions } from "@/lib/api/hr";

interface KpiTileProps {
  label: string;
  value: number | string;
  sub?: string;
}

function KpiTile({ label, value, sub }: KpiTileProps) {
  return (
    <div className="border border-line bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-widest text-ink-3">{label}</div>
      <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export default function HrHomePage() {
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const { data: empData } = useQuery({
    queryKey: ["hr", "employees"],
    queryFn: () => listEmployees(),
  });

  const { data: depts = [] } = useQuery({
    queryKey: ["hr", "departments"],
    queryFn: () => listDepartments(),
  });

  const { data: positions = [] } = useQuery({
    queryKey: ["hr", "positions"],
    queryFn: () => listPositions(),
  });

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "HR Hub", href: "/hr/home" }, { label: "Dashboard" }]} />

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-base font-semibold text-ink">HR Dashboard</h1>
          <span className="font-mono text-xs text-ink-3">{today}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <KpiTile
            label="Total Employees"
            value={empData?.total ?? 0}
            sub="Across all departments"
          />
          <KpiTile
            label="Departments"
            value={depts.length}
            sub="Organizational units"
          />
          <KpiTile
            label="Positions"
            value={positions.length}
            sub="Defined job positions"
          />
          <KpiTile
            label="Active Employees"
            value={empData?.items.filter(e => e.status === "active").length ?? 0}
            sub="Currently active headcount"
          />
        </div>
      </div>
    </div>
  );
}
