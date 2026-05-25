"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Pencil, Trash2, Pin, PinOff, Copy, ArrowLeft } from "lucide-react";
import { Button, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getDashboard,
  getSummaryMetrics,
  getTimeseries,
  getByStatus,
  updateDashboard,
  deleteDashboard,
  createDashboard,
  type Dashboard,
  type WidgetCfg,
  type SummaryMetrics,
  type TimeseriesPoint,
  type ByStatusPoint,
} from "@/lib/api/reports";
import { KpiTile } from "@/primitives/dashboard/widgets/KpiTile";
import { ChartWidget } from "@/primitives/dashboard/widgets/ChartWidget";
import { ListWidget } from "@/primitives/dashboard/widgets/ListWidget";

// ─── Prebuilt dashboard definitions ─────────────────────────────────────────

type PrebuiltKey = "exec" | "mfg" | "quality";

interface PrebuiltDef {
  name: string;
  description: string;
  visibility: "tenant";
  widgets: WidgetCfg[];
}

const PREBUILTS: Record<PrebuiltKey, PrebuiltDef> = {
  exec: {
    name: "Executive Overview",
    description: "Cross-functional KPIs — projects, tasks, workflows, and audit activity.",
    visibility: "tenant",
    widgets: [
      { id: "kpi-proj-total",   kind: "kpi",   x: 0,  y: 0, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "projects.total"   }, title: "Total Projects"    } },
      { id: "kpi-proj-active",  kind: "kpi",   x: 3,  y: 0, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "projects.active"  }, title: "Active Projects"   } },
      { id: "kpi-tasks-open",   kind: "kpi",   x: 6,  y: 0, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "tasks.open"       }, title: "Open Tasks"        } },
      { id: "kpi-tasks-done",   kind: "kpi",   x: 9,  y: 0, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "tasks.done"       }, title: "Tasks Done"        } },
      { id: "kpi-wf-today",     kind: "kpi",   x: 0,  y: 2, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "workflowRunsToday"}, title: "Workflow Runs Today"} },
      { id: "kpi-audit-24h",    kind: "kpi",   x: 3,  y: 2, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "auditEvents24h"   }, title: "Audit Events (24h)" } },
      { id: "kpi-tasks-overdue",kind: "kpi",   x: 6,  y: 2, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "tasks.overdue"    }, title: "Overdue Tasks"     } },
      { id: "kpi-docs-total",   kind: "kpi",   x: 9,  y: 2, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "documents.total"  }, title: "Documents"         } },
      { id: "chart-audit",      kind: "chart", x: 0,  y: 4, w: 8, h: 4, config: { dataSource: { kind: "timeseries", metric: "audit_events", days: 14 }, title: "Audit Events (14 days)" } },
      { id: "list-tasks",       kind: "list",  x: 8,  y: 4, w: 4, h: 4, config: { dataSource: { kind: "by-status", metric: "tasks"         }, title: "Tasks by Status"   } },
    ],
  },
  mfg: {
    name: "Manufacturing",
    description: "Work order status, throughput, and MRP release trends.",
    visibility: "tenant",
    widgets: [
      { id: "kpi-wo-total",    kind: "kpi",   x: 0,  y: 0, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "workOrders.total"     }, title: "Total Work Orders"   } },
      { id: "kpi-wo-released", kind: "kpi",   x: 3,  y: 0, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "workOrders.released"  }, title: "Released"            } },
      { id: "kpi-wo-inprog",   kind: "kpi",   x: 6,  y: 0, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "workOrders.inProgress"}, title: "In Progress"         } },
      { id: "kpi-wo-done",     kind: "kpi",   x: 9,  y: 0, w: 3, h: 2, config: { dataSource: { kind: "summary", field: "workOrders.completed" }, title: "Completed"           } },
      { id: "chart-wo",        kind: "chart", x: 0,  y: 2, w: 8, h: 4, config: { dataSource: { kind: "timeseries", metric: "wo_releases", days: 14 }, title: "WO Releases (14 days)" } },
      { id: "list-wo",         kind: "list",  x: 8,  y: 2, w: 4, h: 4, config: { dataSource: { kind: "by-status", metric: "work_orders"       }, title: "Work Orders by Status" } },
    ],
  },
  quality: {
    name: "Quality",
    description: "NCR open count, FMEA high-RPN items, and audit event trends.",
    visibility: "tenant",
    widgets: [
      { id: "kpi-ncrs",        kind: "kpi",   x: 0,  y: 0, w: 4, h: 2, config: { dataSource: { kind: "summary", field: "ncrsOpen"    }, title: "Open NCRs"           } },
      { id: "kpi-fmea",        kind: "kpi",   x: 4,  y: 0, w: 4, h: 2, config: { dataSource: { kind: "summary", field: "fmeaHighRpn" }, title: "FMEA High RPN (>100)"} },
      { id: "kpi-docs-draft",  kind: "kpi",   x: 8,  y: 0, w: 4, h: 2, config: { dataSource: { kind: "summary", field: "documents.draft" }, title: "Draft Documents"  } },
      { id: "chart-audit-q",   kind: "chart", x: 0,  y: 2, w: 8, h: 4, config: { dataSource: { kind: "timeseries", metric: "audit_events", days: 14 }, title: "Audit Events (14 days)" } },
      { id: "list-ncrs",       kind: "list",  x: 8,  y: 2, w: 4, h: 4, config: { dataSource: { kind: "by-status", metric: "ncrs"       }, title: "NCRs by Status"      } },
    ],
  },
};

const PREBUILT_KEYS = new Set<string>(["exec", "mfg", "quality"]);

// ─── Widget data loading ─────────────────────────────────────────────────────

interface ResolvedWidget extends WidgetCfg {
  resolvedValue?: number | string;
  resolvedData?: number[];
  resolvedItems?: { label: string; meta?: string }[];
  loading: boolean;
}

function useWidgetData(widgets: WidgetCfg[], summary: SummaryMetrics | null) {
  const [resolved, setResolved] = useState<ResolvedWidget[]>([]);

  useEffect(() => {
    if (widgets.length === 0) { setResolved([]); return; }
    const init = widgets.map((w) => ({ ...w, loading: true }));
    setResolved(init);

    const load = async () => {
      const results = await Promise.all(widgets.map(async (w): Promise<ResolvedWidget> => {
        const ds = w.config.dataSource as { kind: string; field?: string; metric?: string; days?: number } | undefined;
        if (!ds) return { ...w, loading: false };

        try {
          if (ds.kind === "summary" && ds.field) {
            const val = resolveField(summary, ds.field);
            return { ...w, loading: false, resolvedValue: val ?? 0 };
          }
          if (ds.kind === "timeseries" && ds.metric) {
            const pts = await getTimeseries(
              ds.metric as "audit_events" | "workflow_runs" | "task_throughput" | "wo_releases",
              ds.days ?? 14
            );
            return { ...w, loading: false, resolvedData: pts.map((p: TimeseriesPoint) => p.count) };
          }
          if (ds.kind === "by-status" && ds.metric) {
            const pts = await getByStatus(
              ds.metric as "projects" | "tasks" | "work_orders" | "ncrs" | "documents"
            );
            return {
              ...w, loading: false,
              resolvedItems: pts.map((p: ByStatusPoint) => ({ label: p.status, meta: String(p.count) }))
            };
          }
        } catch {
          // ignore
        }
        return { ...w, loading: false };
      }));
      setResolved(results);
    };

    load();
  }, [widgets, summary]);

  return resolved;
}

function resolveField(summary: SummaryMetrics | null, field: string): number {
  if (!summary) return 0;
  const parts = field.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = summary;
  for (const p of parts) {
    if (cur == null) return 0;
    cur = cur[p];
  }
  return typeof cur === "number" ? cur : 0;
}

// ─── Widget Renderer ─────────────────────────────────────────────────────────

function WidgetRenderer({ widget }: { widget: ResolvedWidget }) {
  if (widget.loading) {
    return <div className="h-full animate-pulse rounded-md bg-surface-2" />;
  }

  switch (widget.kind) {
    case "kpi":
      return (
        <KpiTile
          title={String(widget.config.title ?? widget.title ?? "")}
          value={widget.resolvedValue ?? 0}
        />
      );
    case "chart":
      return (
        <ChartWidget
          title={String(widget.config.title ?? widget.title ?? "Chart")}
          data={widget.resolvedData}
        />
      );
    case "list":
      return (
        <ListWidget
          title={String(widget.config.title ?? widget.title ?? "List")}
          items={widget.resolvedItems ?? []}
        />
      );
    case "iframe":
      return (
        <iframe
          src={String(widget.config.src ?? "")}
          title={String(widget.config.title ?? "Iframe")}
          className="h-full w-full rounded-md border border-line"
        />
      );
  }
}

// ─── Dashboard grid renderer (read-only) ────────────────────────────────────

const COL_W = 100; // px per grid column
const ROW_H = 60;  // px per row

function StaticDashboardGrid({ widgets }: { widgets: ResolvedWidget[] }) {
  if (widgets.length === 0) {
    return (
      <div className="relative flex h-48 items-center justify-center overflow-hidden rounded-lg border border-dashed border-line-strong bg-paper">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage:
              "linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        <div className="relative text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-3">
            ◇ empty canvas
          </div>
          <div className="mt-1.5 text-[13px] text-ink-3">No widgets configured</div>
        </div>
      </div>
    );
  }

  const maxRow = Math.max(...widgets.map((w) => w.y + w.h));
  const gridH = Math.max(maxRow * ROW_H, 200);

  return (
    <div className="relative w-full overflow-x-auto" style={{ height: gridH }}>
      {/* Blueprint grid background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
          backgroundSize: `${COL_W}px ${ROW_H}px`,
        }}
      />
      {widgets.map((w, i) => (
        <div
          key={w.id}
          className="absolute reveal-w"
          style={{
            left: w.x * COL_W,
            top: w.y * ROW_H,
            width: w.w * COL_W,
            height: w.h * ROW_H,
            padding: 4,
            animationDelay: `${i * 50}ms`,
          }}
        >
          <WidgetRenderer widget={w} />
        </div>
      ))}
      <style jsx>{`
        :global(.reveal-w) {
          opacity: 0;
          transform: translateY(8px);
          animation: revealW 460ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
        }
        @keyframes revealW {
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

function visibilityTone(v: string): "success" | "warning" | "neutral" {
  switch (v) {
    case "tenant": return "success";
    case "team": return "warning";
    default: return "neutral";
  }
}

export default function DashboardViewerPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const isPrebuilt = PREBUILT_KEYS.has(id);
  const prebuilt = isPrebuilt ? PREBUILTS[id as PrebuiltKey] : null;

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [summary, setSummary] = useState<SummaryMetrics | null>(null);
  const [loadingDash, setLoadingDash] = useState(!isPrebuilt);
  const [pinning, setPinning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [mutError, setMutError] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Fetch real summary metrics for all dashboards
  useEffect(() => {
    getSummaryMetrics().then(setSummary).catch(() => null);
  }, []);

  // Fetch dashboard (non-prebuilt)
  useEffect(() => {
    if (isPrebuilt) return;
    setLoadingDash(true);
    getDashboard(id)
      .then(setDashboard)
      .catch((e: unknown) => { setDashboardError((e as Error).message); return null; })
      .finally(() => setLoadingDash(false));
  }, [id, isPrebuilt]);

  const name = prebuilt?.name ?? dashboard?.name ?? "";
  const description = prebuilt?.description ?? dashboard?.description ?? "";
  const visibility = prebuilt?.visibility ?? dashboard?.visibility ?? "private";
  const widgets: WidgetCfg[] = prebuilt?.widgets ?? dashboard?.widgets ?? [];

  const resolvedWidgets = useWidgetData(widgets, summary);

  const handlePin = useCallback(async () => {
    if (!dashboard) return;
    setPinning(true);
    setMutError(null);
    try {
      const updated = await updateDashboard(dashboard.id, {
        isPinned: !dashboard.isPinned,
        version: dashboard.version,
      });
      setDashboard(updated);
    } catch (e) {
      setMutError((e as Error).message);
    } finally {
      setPinning(false);
    }
  }, [dashboard]);

  const handleDelete = useCallback(async () => {
    if (!dashboard) return;
    setDeleting(true);
    setMutError(null);
    try {
      await deleteDashboard(dashboard.id, dashboard.version);
      router.push("/pm/reports");
    } catch (e) {
      setMutError((e as Error).message);
      setDeleting(false);
    }
  }, [dashboard, router]);

  const handleDuplicate = useCallback(async () => {
    const srcWidgets = prebuilt?.widgets ?? dashboard?.widgets ?? [];
    const srcName = prebuilt?.name ?? dashboard?.name ?? "Dashboard";
    setMutError(null);
    try {
      const dup = await createDashboard({
        name: `${srcName} (copy)`,
        description: prebuilt?.description ?? dashboard?.description ?? "",
        visibility: "private",
        widgets: srcWidgets,
        layout: dashboard?.layout,
      });
      router.push(`/pm/reports/${dup.id}`);
    } catch (e) {
      setMutError((e as Error).message);
    }
  }, [prebuilt, dashboard, router]);

  if (loadingDash) {
    return (
      <div className="flex h-full flex-col gap-0">
        <Breadcrumb items={[{ label: "Reports & BI", href: "/pm/reports" }, { label: "Loading…" }]} />
        <div className="flex-1 px-6 py-5 space-y-4">
          {[1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-lg bg-surface-2" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-0">
      <Breadcrumb items={[{ label: "Reports & BI", href: "/pm/reports" }, { label: name }]} />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1400px] px-6 py-6 space-y-5">
          {dashboardError && (
            <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
              {dashboardError}
            </div>
          )}
          {mutError && (
            <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
              {mutError}
            </div>
          )}
          {/* Editorial header */}
          <header className="flex items-end justify-between gap-6 border-b border-line pb-5">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
                <button
                  type="button"
                  aria-label="Back to reports"
                  title="Back to reports"
                  className="rounded p-0.5 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                  onClick={() => router.push("/pm/reports")}
                >
                  <ArrowLeft size={13} />
                </button>
                <span>◢ dashboard</span>
                <span className="rounded-sm border border-line-strong bg-paper px-1.5 py-0.5">
                  {isPrebuilt ? (params.id as string).toUpperCase() : `id·${(dashboard?.id ?? "").slice(0, 8)}`}
                </span>
                {isPrebuilt && <span>prebuilt</span>}
              </div>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">{name}</h1>
              {description && <p className="max-w-2xl text-[13px] leading-relaxed text-ink-3">{description}</p>}
              <div className="flex items-center gap-2 pt-1">
                <Tag tone={visibilityTone(visibility)} size="sm">{visibility}</Tag>
                {dashboard?.isPinned && <Tag tone="signal" size="sm">Pinned</Tag>}
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                  {resolvedWidgets.length}·widgets
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {!isPrebuilt && dashboard && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handlePin}
                    disabled={pinning}
                    title={dashboard.isPinned ? "Unpin" : "Pin to top"}
                  >
                    {dashboard.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => router.push(`/pm/reports/${dashboard.id}/edit`)}
                  >
                    <Pencil size={14} className="mr-1" />Edit
                  </Button>
                </>
              )}
              <Button size="sm" variant="secondary" onClick={handleDuplicate}>
                <Copy size={14} className="mr-1" />Duplicate
              </Button>
              {!isPrebuilt && dashboard && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  <Trash2 size={14} className="mr-1" />Delete
                </Button>
              )}
            </div>
          </header>

          {/* Dashboard canvas */}
          <div className="rounded-lg border border-line-strong bg-surface p-5 shadow-xs min-h-[400px]">
            <StaticDashboardGrid widgets={resolvedWidgets} />
          </div>
        </div>
      </div>
    </div>
  );
}
