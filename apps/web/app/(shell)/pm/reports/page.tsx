"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, BarChart2, Factory, ShieldCheck, Pin, Pencil, Trash2, ExternalLink } from "lucide-react";
import { Button, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listDashboards,
  deleteDashboard,
  type Dashboard,
} from "@/lib/api/reports";

const PREBUILT = [
  {
    key: "exec",
    name: "Executive Overview",
    description: "Cross-functional KPIs — projects, tasks, workflows, audit.",
    icon: BarChart2,
    color: "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800",
    iconColor: "text-blue-600 dark:text-blue-400",
  },
  {
    key: "mfg",
    name: "Manufacturing",
    description: "Work order status, MRP throughput, and WO release trends.",
    icon: Factory,
    color: "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800",
    iconColor: "text-amber-600 dark:text-amber-400",
  },
  {
    key: "quality",
    name: "Quality",
    description: "NCR open count, FMEA high-RPN items, and audit event trends.",
    icon: ShieldCheck,
    color: "bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800",
    iconColor: "text-green-600 dark:text-green-400",
  },
];

function visibilityTone(v: Dashboard["visibility"]): "success" | "warning" | "neutral" {
  switch (v) {
    case "tenant": return "success";
    case "team": return "warning";
    default: return "neutral";
  }
}

export default function ReportsPage() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await listDashboards({ limit: 100 });
      setDashboards(items);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const pinned = dashboards.filter((d) => d.isPinned);
  const mine = dashboards.filter((d) => !d.isPinned);

  async function handleDelete(d: Dashboard) {
    if (!window.confirm) return; // no-op guard; real UI uses inline confirm
    setDeleting(d.id);
    try {
      await deleteDashboard(d.id, d.version);
      setDashboards((prev) => prev.filter((x) => x.id !== d.id));
    } catch {
      // silent
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex h-full flex-col gap-0">
      <Breadcrumb items={[{ label: "Reports & BI" }]} />
      <CommandBar
        actions={[
          {
            id: "new",
            label: "+ New Dashboard",
            icon: Plus,
            primary: true,
            onClick: () => router.push("/pm/reports/new"),
          },
        ]}
      />

      <div className="flex-1 overflow-auto px-6 py-5 space-y-8">
        {/* Pinned dashboards */}
        {pinned.length > 0 && (
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              <Pin size={12} /> Pinned
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pinned.map((d) => (
                <DashboardCard
                  key={d.id}
                  dashboard={d}
                  onOpen={() => router.push(`/pm/reports/${d.id}`)}
                  onEdit={() => router.push(`/pm/reports/${d.id}/edit`)}
                  onDelete={() => handleDelete(d)}
                  isDeleting={deleting === d.id}
                />
              ))}
            </div>
          </section>
        )}

        {/* Prebuilt dashboards */}
        <section>
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            Prebuilt Dashboards
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PREBUILT.map((pb) => {
              const Icon = pb.icon;
              return (
                <button
                  key={pb.key}
                  onClick={() => router.push(`/pm/reports/${pb.key}`)}
                  className={`group flex flex-col gap-3 rounded-lg border p-5 text-left shadow-xs transition-all hover:shadow-md ${pb.color}`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg bg-white/60 dark:bg-black/20 ${pb.iconColor}`}>
                    <Icon size={20} />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-ink">{pb.name}</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-ink-3">{pb.description}</div>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] font-medium text-ink-3 group-hover:text-ink transition-colors">
                    <ExternalLink size={11} /> Open dashboard
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* My dashboards */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
              My Dashboards
            </h2>
            <Button size="sm" variant="secondary" onClick={() => router.push("/pm/reports/new")}>
              <Plus size={13} className="mr-1" />
              New
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-md bg-surface-2" />
              ))}
            </div>
          ) : mine.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line py-10 text-center text-sm text-ink-3">
              No custom dashboards yet.{" "}
              <button
                className="text-accent underline-offset-2 hover:underline"
                onClick={() => router.push("/pm/reports/new")}
              >
                Create one
              </button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left">
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Name</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Visibility</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Widgets</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Updated</th>
                    <th className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3" />
                  </tr>
                </thead>
                <tbody>
                  {mine.map((d) => (
                    <tr
                      key={d.id}
                      className="border-b border-line/60 last:border-0 hover:bg-surface-2/60 cursor-pointer"
                      onClick={() => router.push(`/pm/reports/${d.id}`)}
                    >
                      <td className="px-4 py-3 font-medium text-ink">{d.name}</td>
                      <td className="px-4 py-3">
                        <Tag tone={visibilityTone(d.visibility)} size="sm">{d.visibility}</Tag>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-3">{d.widgets.length}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ink-3">
                        {d.updatedAt ? new Date(d.updatedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button
                            className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
                            onClick={() => router.push(`/pm/reports/${d.id}/edit`)}
                            title="Edit"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="rounded p-1.5 text-ink-3 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                            onClick={() => handleDelete(d)}
                            disabled={deleting === d.id}
                            title="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function DashboardCard({
  dashboard,
  onOpen,
  onEdit,
  onDelete,
  isDeleting,
}: {
  dashboard: Dashboard;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <div
      className="group relative flex cursor-pointer flex-col gap-2 rounded-lg border border-line bg-surface p-4 shadow-xs transition-all hover:shadow-md"
      onClick={onOpen}
    >
      {dashboard.isPinned && (
        <Pin size={12} className="absolute right-3 top-3 text-accent opacity-60" />
      )}
      <div className="font-semibold text-ink">{dashboard.name}</div>
      {dashboard.description && (
        <div className="text-[12px] leading-relaxed text-ink-3 line-clamp-2">{dashboard.description}</div>
      )}
      <div className="flex items-center justify-between pt-1">
        <span className="font-mono text-[11px] text-ink-3">{dashboard.widgets.length} widgets</span>
        <span className="font-mono text-[11px] text-ink-3">
          {dashboard.updatedAt ? new Date(dashboard.updatedAt).toLocaleDateString() : "—"}
        </span>
      </div>
      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        <button
          className="rounded px-2 py-1 text-[11px] text-ink-3 hover:bg-surface-2 hover:text-ink"
          onClick={onEdit}
        >
          <Pencil size={11} className="inline mr-1" />Edit
        </button>
        <button
          className="rounded px-2 py-1 text-[11px] text-ink-3 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
          onClick={onDelete}
          disabled={isDeleting}
        >
          <Trash2 size={11} className="inline mr-1" />Delete
        </button>
      </div>
    </div>
  );
}
