"use client";
import { useState, useEffect } from "react";
import { DashboardGrid } from "@/primitives/dashboard/DashboardGrid";
import type { DashboardDef } from "@/primitives/dashboard/dashboard.types";
import { listProjects, type Project } from "@/lib/api/projects";
import { listAllTasks } from "@/lib/api/tasks";

function relTime(iso: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "<1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function AppHome() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      listProjects({ limit: 100 }),
      listAllTasks({ status: "todo", limit: 200 }),
      listAllTasks({ limit: 200 }),
    ])
      .then(([p, open, all]) => {
        setProjects(p.items);
        setOpenCount(open.total);
        setTotalCount(all.total);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const activeProjects = projects.filter(p => p.status === "active");
  const recent5 = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const def: DashboardDef = {
    id: "home",
    name: "Home",
    widgets: [
      {
        id: "k1", kind: "kpi", x: 0, y: 0, w: 3, h: 2,
        config: { title: "Active Projects", value: activeProjects.length, sub: "projects", spark: Array(7).fill(activeProjects.length) },
      },
      {
        id: "k2", kind: "kpi", x: 3, y: 0, w: 3, h: 2,
        config: { title: "Open Tasks", value: openCount, sub: "needs attention", spark: Array(7).fill(openCount) },
      },
      {
        id: "k3", kind: "kpi", x: 6, y: 0, w: 3, h: 2,
        config: { title: "Total Tasks", value: totalCount, sub: "all statuses", spark: Array(7).fill(totalCount) },
      },
      {
        id: "l1", kind: "list", x: 0, y: 2, w: 6, h: 4,
        config: {
          title: "Recently Updated Projects",
          items: recent5.map(p => ({ label: p.name, meta: relTime(p.updatedAt) })),
        },
      },
    ],
  };

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Dashboard</h1>
        <p className="mt-1 text-xl font-semibold text-ink">Home</p>
      </div>
      {error && (
        <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
          {error}
        </div>
      )}
      {loading ? (
        <div className="font-mono text-[11px] text-ink-3">Loading dashboard…</div>
      ) : (
        <DashboardGrid def={def} />
      )}
    </div>
  );
}
