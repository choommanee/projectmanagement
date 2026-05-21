"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X, Save, ArrowLeft } from "lucide-react";
import { Button, Input } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  createDashboard,
  type WidgetCfg,
  type LayoutCfg,
  type DashboardVisibility,
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
  { value: "tasks.open",           label: "Tasks — Open" },
  { value: "tasks.done",           label: "Tasks — Done" },
  { value: "workOrders.total",     label: "Work Orders — Total" },
  { value: "workOrders.released",  label: "Work Orders — Released" },
  { value: "ncrsOpen",             label: "NCRs — Open" },
  { value: "fmeaHighRpn",          label: "FMEA — High RPN" },
  { value: "documents.total",      label: "Documents — Total" },
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

function makeWidget(kind: WidgetCfg["kind"], existing: WidgetCfg[], def: { defaultW: number; defaultH: number }): WidgetCfg {
  const maxY = existing.length > 0 ? Math.max(...existing.map((w) => w.y + w.h)) : 0;
  const config: Record<string, unknown> = {
    title: kind === "kpi" ? "KPI" : kind === "chart" ? "Chart" : kind === "list" ? "List" : "Iframe",
  };
  if (kind === "kpi") config.dataSource = { kind: "summary", field: "projects.total" };
  else if (kind === "chart") config.dataSource = { kind: "timeseries", metric: "audit_events", days: 14 };
  else if (kind === "list") config.dataSource = { kind: "by-status", metric: "tasks" };
  else if (kind === "iframe") config.src = "https://";
  return { id: `w-${Date.now()}`, kind, x: 0, y: maxY, w: def.defaultW, h: def.defaultH, config };
}

function WidgetInlineConfig({ widget, onChange }: { widget: WidgetCfg; onChange: (w: WidgetCfg) => void }) {
  const ds = (widget.config.dataSource ?? {}) as Record<string, unknown>;
  const upd = (key: string, val: unknown) => onChange({ ...widget, config: { ...widget.config, [key]: val } });
  const updDs = (key: string, val: unknown) => upd("dataSource", { ...ds, [key]: val });

  return (
    <div className="mt-2 space-y-2 rounded border border-line bg-surface p-3">
      <div>
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">Title</label>
        <Input value={String(widget.config.title ?? "")} onChange={(e) => upd("title", e.target.value)} />
      </div>
      {widget.kind === "kpi" && (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">Summary Field</label>
          <select
            className="w-full rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
            value={String(ds.field ?? "projects.total")}
            onChange={(e) => updDs("field", e.target.value)}
          >
            {SUMMARY_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
      )}
      {widget.kind === "chart" && (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">Metric</label>
          <select
            className="w-full rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
            value={String(ds.metric ?? "audit_events")}
            onChange={(e) => updDs("metric", e.target.value)}
          >
            {TIMESERIES_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      )}
      {widget.kind === "list" && (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">Data Source</label>
          <select
            className="w-full rounded border border-line bg-surface px-2 py-1 text-xs text-ink focus:border-accent focus:outline-none"
            value={String(ds.metric ?? "tasks")}
            onChange={(e) => updDs("metric", e.target.value)}
          >
            {BY_STATUS_METRICS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
      )}
      {widget.kind === "iframe" && (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">URL</label>
          <Input value={String(widget.config.src ?? "")} onChange={(e) => upd("src", e.target.value)} placeholder="https://…" />
        </div>
      )}
    </div>
  );
}

export default function NewDashboardPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<DashboardVisibility>("private");
  const [widgets, setWidgets] = useState<WidgetCfg[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = useCallback((kind: WidgetCfg["kind"]) => {
    const def = WIDGET_KINDS.find((k) => k.kind === kind)!;
    const w = makeWidget(kind, widgets, def);
    setWidgets((prev) => [...prev, w]);
    setSelectedId(w.id);
  }, [widgets]);

  const handleChange = useCallback((updated: WidgetCfg) => {
    setWidgets((prev) => prev.map((w) => (w.id === updated.id ? updated : w)));
  }, []);

  const handleRemove = useCallback((wid: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== wid));
    if (selectedId === wid) setSelectedId(null);
  }, [selectedId]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const layout: LayoutCfg[] = widgets.map((w) => ({ i: w.id, x: w.x, y: w.y, w: w.w, h: w.h }));
      const d = await createDashboard({ name: name.trim(), description, visibility, widgets, layout });
      router.push(`/pm/reports/${d.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
      setSaving(false);
    }
  }, [name, description, visibility, widgets, router]);

  const maxRow = widgets.length > 0 ? Math.max(...widgets.map((w) => w.y + w.h)) : 4;

  return (
    <div className="flex h-full flex-col gap-0">
      <Breadcrumb items={[{ label: "Reports & BI", href: "/pm/reports" }, { label: "New Dashboard" }]} />

      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-line px-6 py-3 gap-4">
        <div className="flex items-center gap-3 flex-1">
          <button className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink" onClick={() => router.back()}>
            <ArrowLeft size={16} />
          </button>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dashboard name…"
            size="sm"
            className="max-w-xs font-semibold"
          />
          <select
            className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as DashboardVisibility)}
          >
            <option value="private">Private</option>
            <option value="team">Team</option>
            <option value="tenant">Tenant</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-danger">{error}</span>}
          <Button variant="secondary" size="sm" onClick={() => router.back()} disabled={saving}>Discard</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            <Save size={14} className="mr-1" />{saving ? "Saving…" : "Create Dashboard"}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left palette */}
        <div className="flex w-64 flex-col gap-4 border-r border-line bg-surface-2 p-4 overflow-y-auto">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Description</label>
            <textarea
              className="w-full resize-none rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description…"
            />
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Add Widget</div>
            <div className="space-y-1.5">
              {WIDGET_KINDS.map((def) => (
                <button
                  key={def.kind}
                  onClick={() => handleAdd(def.kind)}
                  className="flex w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left text-[13px] font-medium text-ink hover:border-accent hover:bg-accent/5 transition-colors"
                >
                  <Plus size={13} className="shrink-0 text-accent" />{def.label}
                </button>
              ))}
            </div>
          </div>

          {widgets.length > 0 && (
            <div className="flex-1 space-y-2 overflow-y-auto">
              <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Widgets</div>
              {widgets.map((w) => (
                <div key={w.id} className="rounded-md border border-line bg-surface">
                  <div
                    className={`flex cursor-pointer items-center justify-between px-3 py-2 text-[12px] font-medium ${selectedId === w.id ? "text-accent" : "text-ink"}`}
                    onClick={() => setSelectedId(selectedId === w.id ? null : w.id)}
                  >
                    <span className="truncate uppercase tracking-wider opacity-70">{w.kind}</span>
                    <button
                      className="ml-1 shrink-0 rounded p-0.5 text-ink-3 hover:text-danger"
                      onClick={(e) => { e.stopPropagation(); handleRemove(w.id); }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                  {selectedId === w.id && (
                    <WidgetInlineConfig widget={w} onChange={handleChange} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Center grid preview */}
        <div className="flex-1 overflow-auto bg-surface p-6">
          {widgets.length === 0 ? (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-line text-sm text-ink-3">
              Add widgets from the left panel
            </div>
          ) : (
            <div className="relative" style={{ height: Math.max(maxRow, 4) * ROW_H }}>
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
                    selectedId === w.id ? "border-accent shadow-md" : "border-line hover:border-accent/50"
                  }`}
                  style={{ left: w.x * COL_W + 4, top: w.y * ROW_H + 4, width: w.w * COL_W - 8, height: w.h * ROW_H - 8 }}
                  onClick={() => setSelectedId(selectedId === w.id ? null : w.id)}
                >
                  <div className="flex h-full items-center justify-center gap-1 text-[11px] text-ink-3">
                    <span className="uppercase tracking-wider opacity-60">{w.kind}</span>
                    <span className="text-ink">{String(w.config.title ?? "")}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
