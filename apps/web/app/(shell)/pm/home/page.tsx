"use client";
import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { DashboardGrid } from "@/primitives/dashboard/DashboardGrid";
import type { DashboardDef } from "@/primitives/dashboard/dashboard.types";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
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

export default function PMHome() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [inProgressCount, setInProgressCount] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      listProjects({ limit: 100 }),
      listAllTasks({ status: "todo", limit: 200 }),
      listAllTasks({ status: "in_progress", limit: 200 }),
      listAllTasks({ status: "done", limit: 200 }),
    ])
      .then(([p, open, inProg, done]) => {
        setProjects(p.items);
        setOpenCount(open.total);
        setInProgressCount(inProg.total);
        setDoneCount(done.total);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const activeProjects = projects.filter(p => p.status === "active");
  const totalTasks = openCount + inProgressCount + doneCount;
  const completionPct = totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0;
  const recent5 = [...projects]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  const def: DashboardDef = {
    id: "pm-home",
    name: "PM Home",
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
        config: { title: "In Progress", value: inProgressCount, sub: "active work", spark: Array(7).fill(inProgressCount) },
      },
      {
        id: "k4", kind: "kpi", x: 9, y: 0, w: 3, h: 2,
        config: { title: "Completion", value: `${completionPct}%`, sub: "of all tasks", spark: Array(7).fill(completionPct) },
      },
      {
        id: "c1", kind: "chart", x: 0, y: 2, w: 8, h: 4,
        config: { title: "Task Status Distribution" },
      },
      {
        id: "l1", kind: "list", x: 8, y: 2, w: 4, h: 4,
        config: {
          title: "Recently Updated Projects",
          items: recent5.map(p => ({ label: p.name, meta: relTime(p.updatedAt) })),
        },
      },
    ],
  };

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "PM Hub", href: "/pm/home" }, { label: "Home" }]} />
      <CommandBar actions={[
        { id: "refresh", label: "Refresh", variant: "ghost", icon: <RefreshCw size={13} />, onClick: () => window.location.reload() },
      ]} />
      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4">
          <h1 className="font-mono text-[11px] uppercase tracking-wider text-ink-3">Dashboard</h1>
          <p className="mt-1 text-xl font-semibold text-ink">PM Home</p>
        </div>
        {error && (
          <p className="mb-4 text-sm text-danger">{error}</p>
        )}
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-surface-2" />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 h-48 animate-pulse rounded-lg border border-border bg-surface-2" />
              <div className="h-48 animate-pulse rounded-lg border border-border bg-surface-2" />
            </div>
          </div>
        ) : (
          <DashboardGrid def={def} />
        )}
      </div>
    </div>
  );
}
