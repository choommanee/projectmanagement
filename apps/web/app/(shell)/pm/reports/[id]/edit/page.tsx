"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Plus, Trash2, X, Save, ArrowLeft } from "lucide-react";
import { Button, Input } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getDashboard,
  updateDashboard,
  type Dashboard,
  type WidgetCfg,
  type LayoutCfg,
} from "@/lib/api/reports";

const WIDGET_KINDS: Array<{ kind: WidgetCfg["kind"]; label: string; defaultW: number; defaultH: number }> = [
  { kind: "kpi",    label: "KPI Tile",    defaultW: 3, defaultH: 2 },
  { kind: "chart",  label: "Chart",       defaultW: 6, defaultH: 4 },
  { kind: "list",   label: "List",        defaultW: 4, defaultH: 4 },
  { kind: "iframe", label: "Iframe",      defaultW: 6, defaultH: 4 },
];

const SUMMARY_FIELDS = [
  { value: "projects.total",       label: "Projects — Total" },
  { value: "projects.active",      label: "Projects — Active" },
  { value: "projects.completed",   label: "Projects — Completed" },
  { value: "projects.planning",    label: "Projects — Planning" },
  { value: "tasks.total",          label: "Tasks — Total" },
  { value: "tasks.open",           label: "Tasks — Open" },
  { value: "tasks.done",           label: "Tasks — Done" },
  { value: "tasks.overdue",        label: "Tasks — Overdue" },
  { value: "workOrders.total",     label: "Work Orders — Total" },
  { value: "workOrders.released",  label: "Work Orders — Released" },
  { value: "workOrders.inProgress",label: "Work Orders — In Progress" },
  { value: "workOrders.completed", label: "Work Orders — Completed" },
  { value: "ncrsOpen",             label: "NCRs — Open" },
  { value: "fmeaHighRpn",          label: "FMEA — High RPN (>100)" },
  { value: "documents.total",      label: "Documents — Total" },
  { value: "documents.draft",      label: "Documents — Draft" },
  { value: "documents.approved",   label: "Documents — Approved" },
  { value: "workflowRunsToday",    label: "Workflow Runs Today" },
  { value: "auditEvents24h",       label: "Audit Events (24h)" },
];

const TIMESERIES_METRICS = [
  { value: "audit_events",    label: "Audit Events" },
  { value: "workflow_runs",   label: "Workflow Runs" },
  { value: "task_throughput", label: "Task Throughput" },
  { value: "wo_releases",     label: "WO Releases" },
];

const BY_STATUS_METRICS = [
  { value: "projects",    label: "Projects" },
  { value: "tasks",       label: "Tasks" },
  { value: "work_orders", label: "Work Orders" },
  { value: "ncrs",        label: "NCRs" },
  { value: "documents",   label: "Documents" },
];

const COL_W = 100;
const ROW_H = 60;

function newWidget(kind: WidgetCfg["kind"], existingWidgets: WidgetCfg[], def: { defaultW: number; defaultH: number }): WidgetCfg {
  const maxY = existingWidgets.length > 0
    ? Math.max(...existingWidgets.map((w) => w.y + w.h))
    : 0;

  const defaultConfig: Record<string, unknown> = {
    title: kind === "kpi" ? "KPI" : kind === "chart" ? "Chart" : kind === "list" ? "List" : "Iframe",
  };

  if (kind === "kpi") {
    defaultConfig.dataSource = { kind: "summary", field: "projects.total" };
  } else if (kind === "chart") {
    defaultConfig.dataSource = { kind: "timeseries", metric: "audit_events", days: 14 };
  } else if (kind === "list") {
    defaultConfig.dataSource = { kind: "by-status", metric: "tasks" };
  } else if (kind === "iframe") {
    defaultConfig.src = "https://";
  }

  return {
    id: `w-${Date.now()}`,
    kind,
    x: 0,
    y: maxY,
    w: def.defaultW,
    h: def.defaultH,
    config: defaultConfig,
  };
}

interface WidgetConfigPanelProps {
  widget: WidgetCfg;
  onChange: (w: WidgetCfg) => void;
  onClose: () => void;
}

function WidgetConfigPanel({ widget, onChange, onClose }: WidgetConfigPanelProps) {
  const updateConfig = (key: string, value: unknown) => {
    onChange({ ...widget, config: { ...widget.config, [key]: value } });
  };
  const updateDs = (key: string, value: unknown) => {
    const ds = (widget.config.dataSource ?? {}) as Record<string, unknown>;
    updateConfig("dataSource", { ...ds, [key]: value });
  };
  const ds = (widget.config.dataSource ?? {}) as Record<string, unknown>;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">Widget Config</h3>
        <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-surface-2">
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Title</label>
          <Input
            value={String(widget.config.title ?? "")}
            onChange={(e) => updateConfig("title", e.target.value)}
          />
        </div>

        {widget.kind === "kpi" && (
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Data Source (Summary Field)</label>
            <select
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              value={String(ds.field ?? "projects.total")}
              onChange={(e) => updateDs("field", e.target.value)}
            >
              {SUMMARY_FIELDS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        )}

        {widget.kind === "chart" && (
          <>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Metric</label>
              <select
                className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                value={String(ds.metric ?? "audit_events")}
                onChange={(e) => updateDs("metric", e.target.value)}
              >
                {TIMESERIES_METRICS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Days</label>
              <Input
                type="number"
                value={String(ds.days ?? 14)}
                onChange={(e) => updateDs("days", parseInt(e.target.value) || 14)}
              />
            </div>
          </>
        )}

        {widget.kind === "list" && (
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Data Source</label>
            <select
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              value={String(ds.metric ?? "tasks")}
              onChange={(e) => updateDs("metric", e.target.value)}
            >
              {BY_STATUS_METRICS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        )}

        {widget.kind === "iframe" && (
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">URL</label>
            <Input
              value={String(widget.config.src ?? "")}
              onChange={(e) => updateConfig("src", e.target.value)}
              placeholder="https://..."
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">X</label>
            <Input type="number" value={widget.x} onChange={(e) => onChange({ ...widget, x: parseInt(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Y</label>
            <Input type="number" value={widget.y} onChange={(e) => onChange({ ...widget, y: parseInt(e.target.value) || 0 })} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Width</label>
            <Input type="number" min={1} max={12} value={widget.w} onChange={(e) => onChange({ ...widget, w: parseInt(e.target.value) || 3 })} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-ink-3">Height</label>
            <Input type="number" min={1} value={widget.h} onChange={(e) => onChange({ ...widget, h: parseInt(e.target.value) || 2 })} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DashboardEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [widgets, setWidgets] = useState<WidgetCfg[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getDashboard(id)
      .then((d) => {
        setDashboard(d);
        setWidgets(d.widgets);
      })
      .catch(() => setError("Dashboard not found"))
      .finally(() => setLoading(false));
  }, [id]);

  const selectedWidget = widgets.find((w) => w.id === selectedId) ?? null;

  const handleWidgetChange = useCallback((updated: WidgetCfg) => {
    setWidgets((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  }, []);

  const handleAddWidget = useCallback((kind: WidgetCfg["kind"]) => {
    const def = WIDGET_KINDS.find((k) => k.kind === kind)!;
    const w = newWidget(kind, widgets, def);
    setWidgets((prev) => [...prev, w]);
    setSelectedId(w.id);
  }, [widgets]);

  const handleRemoveWidget = useCallback((widgetId: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== widgetId));
    if (selectedId === widgetId) setSelectedId(null);
  }, [selectedId]);

  const handleSave = useCallback(async () => {
    if (!dashboard) return;
    setSaving(true);
    setError(null);
    try {
      const layout: LayoutCfg[] = widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h }));
      const updated = await updateDashboard(dashboard.id, {
        widgets,
        layout,
        version: dashboard.version,
      });
      setDashboard(updated);
      router.push(`/pm/reports/${dashboard.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [dashboard, widgets, router]);

  if (loading) {
    return (
      <div className="flex h-full flex-col gap-0">
        <Breadcrumb items={[{ label: "Reports & BI", href: "/pm/reports" }, { label: "Edit" }]} />
        <div className="flex-1 px-6 py-5">
          <div className="h-64 animate-pulse rounded-lg bg-surface-2" />
        </div>
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="flex h-full flex-col gap-0">
        <Breadcrumb items={[{ label: "Reports & BI", href: "/pm/reports" }, { label: "Error" }]} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <div className="text-danger">{error}</div>
            <Button onClick={() => router.push("/pm/reports")}>Back to Reports</Button>
          </div>
        </div>
      </div>
    );
  }

  const maxRow = widgets.length > 0 ? Math.max(...widgets.map((w) => w.y + w.h)) : 4;

  return (
    <div className="flex h-full flex-col gap-0">
      <Breadcrumb items={[
        { label: "Reports & BI", href: "/pm/reports" },
        { label: dashboard?.name ?? "Dashboard", href: `/pm/reports/${id}` },
        { label: "Edit" },
      ]} />

      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-line px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
            onClick={() => router.back()}
          >
            <ArrowLeft size={16} />
          </button>
          <span className="font-semibold text-ink">{dashboard?.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-danger">{error}</span>}
          <Button variant="secondary" size="sm" onClick={() => router.back()} disabled={saving}>
            Discard
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            <Save size={14} className="mr-1" />
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Three-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Widget palette */}
        <div className="flex w-52 flex-col gap-3 border-r border-line bg-surface-2 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Add Widget</div>
          <div className="space-y-1.5">
            {WIDGET_KINDS.map((def) => (
              <button
                key={def.kind}
                onClick={() => handleAddWidget(def.kind)}
                className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left text-[13px] font-medium text-ink hover:border-accent hover:bg-accent/5 transition-colors"
              >
                <Plus size={13} className="shrink-0 text-accent" />
                {def.label}
              </button>
            ))}
          </div>

          {widgets.length > 0 && (
            <>
              <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Widgets</div>
              <div className="flex-1 space-y-1 overflow-y-auto">
                {widgets.map((w) => (
                  <div
                    key={w.id}
                    className={`group flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-[12px] ${
                      selectedId === w.id ? "bg-accent/10 text-accent" : "text-ink hover:bg-surface"
                    }`}
                    onClick={() => setSelectedId(selectedId === w.id ? null : w.id)}
                  >
                    <span className="truncate">{String(w.config.title ?? w.kind)}</span>
                    <button
                      className="ml-1 shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-ink-3 hover:text-danger"
                      onClick={(e) => { e.stopPropagation(); handleRemoveWidget(w.id); }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Center: Grid preview */}
        <div className="flex-1 overflow-auto bg-surface p-6">
          <div className="relative" style={{ height: Math.max(maxRow, 4) * ROW_H }}>
            {/* Grid background */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage: "linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
                backgroundSize: `${COL_W}px ${ROW_H}px`,
                opacity: 0.4,
              }}
            />
            {widgets.map((w) => (
              <div
                key={w.id}
                className={`absolute cursor-pointer rounded-md border-2 transition-colors ${
                  selectedId === w.id
                    ? "border-accent shadow-md"
                    : "border-line hover:border-accent/50"
                }`}
                style={{
                  left: w.x * COL_W + 4,
                  top: w.y * ROW_H + 4,
                  width: w.w * COL_W - 8,
                  height: w.h * ROW_H - 8,
                }}
                onClick={() => setSelectedId(selectedId === w.id ? null : w.id)}
              >
                <div className="flex h-full items-center justify-center text-[11px] font-medium text-ink-3">
                  <span className="uppercase tracking-wider opacity-60">{w.kind}</span>
                  <span className="ml-1 text-ink">{String(w.config.title ?? "")}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Config panel */}
        <div className={`w-64 shrink-0 border-l border-line bg-surface transition-all ${selectedWidget ? "visible" : "invisible"}`}>
          {selectedWidget && (
            <WidgetConfigPanel
              widget={selectedWidget}
              onChange={handleWidgetChange}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
