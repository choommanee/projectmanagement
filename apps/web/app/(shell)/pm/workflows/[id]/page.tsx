"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Save, Upload, Play, Trash2, RefreshCw, ChevronRight, Eye, Clock,
  Zap, GitBranch, Globe, UserCheck, Timer, Bell, Square,
  Variable, Plus, X, Check,
} from "lucide-react";
import { Button, Input, Tag, TextArea } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  getWorkflow, listVersions, saveVersion, publishVersion,
  startInstance, listInstances, patchWorkflow,
  type WorkflowDef, type WorkflowVersion, type WorkflowInstance, type DSL, type DslStep,
} from "@/lib/api/workflows";

// ─── Step type metadata ────────────────────────────────────────────────────────

const STEP_TYPES = [
  { type: "expression",    label: "Expression",    icon: Zap,        color: "text-warning" },
  { type: "set_variable",  label: "Set Variable",  icon: Variable,   color: "text-info" },
  { type: "switch",        label: "Switch",        icon: GitBranch,  color: "text-accent" },
  { type: "http",          label: "HTTP",          icon: Globe,      color: "text-success" },
  { type: "human_task",    label: "Human Task",    icon: UserCheck,  color: "text-signal" },
  { type: "wait",          label: "Wait",          icon: Timer,      color: "text-ink-3" },
  { type: "notification",  label: "Notification",  icon: Bell,       color: "text-info" },
  { type: "end",           label: "End",           icon: Square,     color: "text-danger" },
];

function getStepMeta(type: string) {
  return STEP_TYPES.find((s) => s.type === type) ?? { type, label: type, icon: Zap, color: "text-ink-3" };
}

function stepSummary(step: DslStep): string {
  if (step.type === "expression") return String(step.expr ?? "");
  if (step.type === "set_variable") return `${step.name} = ${String(step.value ?? "").slice(0, 30)}`;
  if (step.type === "http") return `${step.method ?? "GET"} ${String(step.url ?? "").slice(0, 40)}`;
  if (step.type === "human_task") return String((step.form as Record<string, unknown>)?.prompt ?? step.assignee ?? "");
  if (step.type === "wait") return String(step.duration ?? "");
  if (step.type === "notification") return String(step.template ?? "");
  if (step.type === "end") return String(step.result ?? "");
  if (step.type === "switch") return `${(step.cases as unknown[])?.length ?? 0} cases`;
  return "";
}

// ─── Custom node component ─────────────────────────────────────────────────────

interface StepNodeData {
  step: DslStep;
  selected: boolean;
  onSelect: (id: string) => void;
}

function StepNodeComponent({ data }: { data: StepNodeData }) {
  const meta = getStepMeta(data.step.type);
  const Icon = meta.icon;
  const summary = stepSummary(data.step);

  return (
    <div
      onClick={() => data.onSelect(data.step.id)}
      className={`w-48 cursor-pointer select-none rounded-md border bg-paper shadow-xs transition-all
        ${data.selected ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-line-strong hover:shadow-sm"}`}
    >
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <Icon size={13} className={meta.color} />
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${meta.color}`}>
          {meta.label}
        </span>
      </div>
      <div className="px-3 py-2">
        <p className="font-mono text-[11px] text-ink">{data.step.id}</p>
        {summary && (
          <p className="mt-0.5 truncate text-[11px] text-ink-3">{summary}</p>
        )}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  step: StepNodeComponent,
};

// ─── DSL ↔ React Flow converters ────────────────────────────────────────────

function dslToFlow(
  steps: DslStep[],
  selectedId: string | null,
  onSelect: (id: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = steps.map((step, i) => ({
    id: step.id,
    type: "step",
    position: { x: 0, y: i * 120 },
    data: { step, selected: step.id === selectedId, onSelect } satisfies StepNodeData,
    draggable: true,
  }));

  const edges: Edge[] = steps.slice(0, -1).map((step, i) => ({
    id: `e-${step.id}-${steps[i + 1].id}`,
    source: step.id,
    target: steps[i + 1].id,
    type: "smoothstep",
    style: { stroke: "var(--line-strong)" },
    animated: false,
  }));

  return { nodes, edges };
}

// ─── Property panel ────────────────────────────────────────────────────────────

interface PropPanelProps {
  step: DslStep | null;
  onChange: (updated: DslStep) => void;
}

function KVEditor({
  value,
  onChange,
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const entries = Object.entries(value);
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1">
          <Input
            value={k}
            onChange={(e) => {
              const next = Object.fromEntries(entries.map(([ok, ov]) => [ok === k ? e.target.value : ok, ov]));
              onChange(next);
            }}
            placeholder="key"
            className="flex-1 text-xs"
          />
          <Input
            value={v}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
            placeholder="value"
            className="flex-1 text-xs"
          />
          <button
            type="button"
            onClick={() => { const next = { ...value }; delete next[k]; onChange(next); }}
            className="rounded p-1 text-ink-3 hover:text-danger"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...value, "": "" })}
        className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
      >
        <Plus size={11} /> Add header
      </button>
    </div>
  );
}

function PropPanel({ step, onChange }: PropPanelProps) {
  if (!step) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-ink-3">
        Click a step to edit its properties
      </div>
    );
  }

  const set = (field: string, value: unknown) => onChange({ ...step, [field]: value });

  return (
    <div className="h-full overflow-y-auto p-3">
      <div className="mb-3 flex items-center gap-2">
        {(() => { const Icon = getStepMeta(step.type).icon; return <Icon size={14} className={getStepMeta(step.type).color} />; })()}
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-2">
          {getStepMeta(step.type).label}
        </span>
      </div>

      <div className="space-y-3 text-xs">
        <div>
          <label className="mb-1 block font-medium text-ink-2">Step ID</label>
          <Input value={step.id} disabled className="font-mono text-xs" />
        </div>

        {step.type === "expression" && (
          <>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Expression (expr)</label>
              <TextArea
                value={String(step.expr ?? "")}
                onChange={(e) => set("expr", e.target.value)}
                rows={3}
                className="font-mono text-xs"
                placeholder="e.g. input.amount * 1.07"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Output variable (out)</label>
              <Input value={String(step.out ?? "")} onChange={(e) => set("out", e.target.value)} placeholder="e.g. tax" />
            </div>
          </>
        )}

        {step.type === "set_variable" && (
          <>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Variable name</label>
              <Input value={String(step.name ?? "")} onChange={(e) => set("name", e.target.value)} placeholder="e.g. approved" />
            </div>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Value (JSON)</label>
              <TextArea
                value={typeof step.value === "string" ? step.value : JSON.stringify(step.value ?? "")}
                onChange={(e) => { try { set("value", JSON.parse(e.target.value)); } catch { set("value", e.target.value); } }}
                rows={3}
                className="font-mono text-xs"
                placeholder="true"
              />
            </div>
          </>
        )}

        {step.type === "switch" && (
          <div>
            <label className="mb-1 block font-medium text-ink-2">Cases (when conditions)</label>
            {((step.cases as Array<{ when: string; do: DslStep[] }>) ?? []).map((c, i) => (
              <div key={i} className="mb-2 rounded border border-line p-2">
                <Input
                  value={c.when}
                  onChange={(e) => {
                    const cases = [...((step.cases as Array<{ when: string; do: DslStep[] }>) ?? [])];
                    cases[i] = { ...cases[i], when: e.target.value };
                    set("cases", cases);
                  }}
                  placeholder="e.g. input.amount > 1000 or default"
                />
                <p className="mt-1 text-[10px] text-ink-3">{c.do?.length ?? 0} sub-steps</p>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                const cases = [...((step.cases as Array<{ when: string; do: DslStep[] }>) ?? [])];
                cases.push({ when: "default", do: [] });
                set("cases", cases);
              }}
              className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
            >
              <Plus size={11} /> Add case
            </button>
          </div>
        )}

        {step.type === "http" && (
          <>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Method</label>
              <select
                value={String(step.method ?? "GET")}
                onChange={(e) => set("method", e.target.value)}
                className="w-full rounded border border-line bg-paper px-2 py-1 text-xs text-ink"
              >
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-ink-2">URL</label>
              <Input value={String(step.url ?? "")} onChange={(e) => set("url", e.target.value)} placeholder="https://..." />
            </div>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Headers</label>
              <KVEditor
                value={(step.headers as Record<string, string>) ?? {}}
                onChange={(v) => set("headers", v)}
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Body (JSON)</label>
              <TextArea
                value={String(step.body ?? "")}
                onChange={(e) => set("body", e.target.value)}
                rows={3}
                className="font-mono text-xs"
                placeholder="{}"
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Retry max</label>
              <Input
                type="number"
                value={String((step.retry as Record<string, number>)?.max ?? 0)}
                onChange={(e) => set("retry", { ...(step.retry as Record<string, number> ?? {}), max: Number(e.target.value), backoff: "exponential" })}
              />
            </div>
          </>
        )}

        {step.type === "human_task" && (
          <>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Assignee (UUID)</label>
              <Input value={String(step.assignee ?? "")} onChange={(e) => set("assignee", e.target.value)} placeholder="UUID or empty" />
            </div>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Form (JSON)</label>
              <TextArea
                value={typeof step.form === "string" ? step.form : JSON.stringify(step.form ?? { prompt: "" }, null, 2)}
                onChange={(e) => { try { set("form", JSON.parse(e.target.value)); } catch { set("form", e.target.value); } }}
                rows={4}
                className="font-mono text-xs"
                placeholder='{"prompt": "Approve?"}'
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-ink-2">SLA deadline (ISO-8601 duration)</label>
              <Input value={String(step.sla ?? "")} onChange={(e) => set("sla", e.target.value)} placeholder="PT4H" />
            </div>
          </>
        )}

        {step.type === "wait" && (
          <div>
            <label className="mb-1 block font-medium text-ink-2">Duration (ISO-8601)</label>
            <Input value={String(step.duration ?? "")} onChange={(e) => set("duration", e.target.value)} placeholder="PT1H" />
          </div>
        )}

        {step.type === "notification" && (
          <>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Channel</label>
              <select
                value={String(step.channel ?? "email")}
                onChange={(e) => set("channel", e.target.value)}
                className="w-full rounded border border-line bg-paper px-2 py-1 text-xs text-ink"
              >
                {["email", "slack", "webhook"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-ink-2">Template</label>
              <Input value={String(step.template ?? "")} onChange={(e) => set("template", e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block font-medium text-ink-2">To</label>
              <Input value={String(step.to ?? "")} onChange={(e) => set("to", e.target.value)} />
            </div>
          </>
        )}

        {step.type === "end" && (
          <div>
            <label className="mb-1 block font-medium text-ink-2">Result</label>
            <Input value={String(step.result ?? "")} onChange={(e) => set("result", e.target.value)} placeholder="done" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Node palette ──────────────────────────────────────────────────────────────

function NodePalette({ onDragStart }: { onDragStart: (type: string) => void }) {
  return (
    <div className="flex h-full flex-col gap-0.5 overflow-y-auto p-2">
      <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">Steps</p>
      {STEP_TYPES.map((s) => {
        const Icon = s.icon;
        return (
          <div
            key={s.type}
            draggable
            onDragStart={() => onDragStart(s.type)}
            className="flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink active:cursor-grabbing"
          >
            <Icon size={13} className={s.color} />
            <span>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Tab: Versions ────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface VersionsTabProps {
  workflowId: string;
  currentVersion: number;
  onPublish: (rev: number) => void;
  onView: (ver: WorkflowVersion) => void;
}

function VersionsTab({ workflowId, currentVersion, onPublish, onView }: VersionsTabProps) {
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    listVersions(workflowId)
      .then(setVersions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [workflowId]);

  if (loading) return <div className="p-6 text-center text-sm text-ink-3">Loading versions…</div>;

  return (
    <div className="overflow-auto p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-xs font-medium uppercase tracking-wide text-ink-3">
            <th className="px-4 py-2 text-left">Rev</th>
            <th className="px-4 py-2 text-left">Notes</th>
            <th className="px-4 py-2 text-left">Published</th>
            <th className="px-4 py-2 text-left">Created</th>
            <th className="px-4 py-2 text-left"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5">
                <span className="font-mono text-xs">
                  r{v.rev}
                  {v.rev === currentVersion && (
                    <span className="ml-1 rounded bg-accent-soft px-1 py-0.5 text-[10px] text-accent">current</span>
                  )}
                </span>
              </td>
              <td className="max-w-xs truncate px-4 py-2.5 text-xs text-ink-2">{v.notes || "—"}</td>
              <td className="px-4 py-2.5 text-xs text-ink-3">{fmtDate(v.publishedAt)}</td>
              <td className="px-4 py-2.5 text-xs text-ink-3">{fmtDate(v.createdAt)}</td>
              <td className="px-4 py-2.5">
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => onView(v)}>
                    <Eye size={12} /> View
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onPublish(v.rev)}>
                    <Upload size={12} /> Publish
                  </Button>
                </div>
              </td>
            </tr>
          ))}
          {versions.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-ink-3">No versions yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tab: Runs ────────────────────────────────────────────────────────────────

type InstanceStatus = WorkflowInstance["status"];

function instTone(s: InstanceStatus): "info" | "success" | "danger" | "warning" | "neutral" {
  if (s === "completed") return "success";
  if (s === "failed") return "danger";
  if (s === "running") return "info";
  if (s === "paused") return "warning";
  return "neutral";
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

interface RunsTabProps {
  workflowId: string;
}

function RunsTab({ workflowId }: RunsTabProps) {
  const router = useRouter();
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await listInstances(workflowId, { limit: 50 });
      setInstances(items);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [workflowId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="p-6 text-center text-sm text-ink-3">Loading runs…</div>;

  return (
    <div className="overflow-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-ink-3">{instances.length} runs</span>
        <Button size="sm" variant="ghost" onClick={load}><RefreshCw size={12} /> Refresh</Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-xs font-medium uppercase tracking-wide text-ink-3">
            <th className="px-4 py-2 text-left">Instance ID</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Trigger</th>
            <th className="px-4 py-2 text-left">Started</th>
            <th className="px-4 py-2 text-left">Ended</th>
            <th className="px-4 py-2 text-left">Duration</th>
          </tr>
        </thead>
        <tbody>
          {instances.map((inst) => (
            <tr
              key={inst.id}
              className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
              onClick={() => router.push(`/pm/workflows/${workflowId}/runs/${inst.id}`)}
            >
              <td className="px-4 py-2.5 font-mono text-xs text-ink">{inst.id.slice(0, 8)}</td>
              <td className="px-4 py-2.5"><Tag tone={instTone(inst.status)}>{inst.status}</Tag></td>
              <td className="px-4 py-2.5 text-xs text-ink-2">{inst.triggerKind || "manual"}</td>
              <td className="px-4 py-2.5 text-xs text-ink-3">{fmtDate(inst.startedAt)}</td>
              <td className="px-4 py-2.5 text-xs text-ink-3">{fmtDate(inst.endedAt)}</td>
              <td className="px-4 py-2.5 text-xs text-ink-3">{fmtDuration(inst.startedAt, inst.endedAt)}</td>
            </tr>
          ))}
          {instances.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-10 text-center text-xs text-ink-3">No runs yet. Click &ldquo;Run Once&rdquo; to start.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Read-only DSL preview modal ───────────────────────────────────────────────

function DslPreviewModal({ version, onClose }: { version: WorkflowVersion; onClose: () => void }) {
  const { nodes, edges } = useMemo(
    () => dslToFlow(version.dsl.steps ?? [], null, () => {}),
    [version.dsl.steps],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex h-[80vh] w-[80vw] flex-col rounded-xl border border-line bg-paper shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Version r{version.rev} — Read-only Preview</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-3 hover:text-ink"><X size={16} /></button>
        </div>
        <div className="flex-1">
          <ReactFlow nodes={nodes} edges={edges} fitView nodeTypes={nodeTypes} nodesDraggable={false}>
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls />
          </ReactFlow>
        </div>
        <div className="border-t border-line px-4 py-2 text-xs text-ink-3">
          {version.dsl.steps?.length ?? 0} steps · Notes: {version.notes || "—"}
        </div>
      </div>
    </div>
  );
}

// ─── Run Once modal ───────────────────────────────────────────────────────────

function RunOnceModal({
  workflowId,
  onClose,
  onStarted,
}: {
  workflowId: string;
  onClose: () => void;
  onStarted: (instanceId: string) => void;
}) {
  const [inputJson, setInputJson] = useState("{}");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(inputJson); } catch { setError("Invalid JSON"); return; }
    setLoading(true);
    setError(null);
    try {
      const inst = await startInstance(workflowId, { input: parsed });
      onStarted(inst.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-lg border border-line bg-paper shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Run Once</h2>
          <button type="button" onClick={onClose}><X size={14} className="text-ink-3" /></button>
        </div>
        <div className="p-4">
          <label className="mb-1 block text-xs font-medium text-ink-2">Input (JSON)</label>
          <TextArea
            value={inputJson}
            onChange={(e) => setInputJson(e.target.value)}
            rows={6}
            className="font-mono text-xs"
            placeholder="{}"
          />
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleRun} disabled={loading}>
            {loading ? "Starting…" : "Run"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Publish confirm modal ────────────────────────────────────────────────────

function PublishModal({
  workflowId,
  draftRev,
  defVersion,
  draftStepCount,
  onClose,
  onPublished,
}: {
  workflowId: string;
  draftRev: number;
  defVersion: number;
  draftStepCount: number;
  onClose: () => void;
  onPublished: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async () => {
    setLoading(true);
    setError(null);
    try {
      await publishVersion(workflowId, { rev: draftRev, version: defVersion });
      onPublished();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-sm rounded-lg border border-line bg-paper shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Publish Draft</h2>
          <button type="button" onClick={onClose}><X size={14} className="text-ink-3" /></button>
        </div>
        <div className="p-4 text-sm text-ink-2">
          <p>Publish <strong>rev {draftRev}</strong> as the live version?</p>
          <p className="mt-1 text-xs text-ink-3">{draftStepCount} step{draftStepCount !== 1 ? "s" : ""} in this draft.</p>
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handle} disabled={loading}>
            <Check size={13} /> {loading ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = "designer" | "versions" | "runs";

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [def, setDef] = useState<WorkflowDef | null>(null);
  const [draftVersion, setDraftVersion] = useState<WorkflowVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("designer");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [dslSteps, setDslSteps] = useState<DslStep[]>([]);
  const dragTypeRef = useRef<string | null>(null);

  const [showRunModal, setShowRunModal] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<WorkflowVersion | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Load definition + latest draft version ──────────────────────────────

  const loadDef = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [wfDef, versions] = await Promise.all([getWorkflow(id), listVersions(id)]);
      setDef(wfDef);
      // Find latest draft (highest rev with no publishedAt)
      const sorted = [...versions].sort((a, b) => b.rev - a.rev);
      const draft = sorted.find((v) => !v.publishedAt) ?? sorted[0] ?? null;
      setDraftVersion(draft);
      if (draft) {
        const steps = draft.dsl?.steps ?? [];
        setDslSteps(steps);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { loadDef(); }, [loadDef]);

  // ── Sync DSL steps → React Flow nodes/edges ─────────────────────────────

  useEffect(() => {
    const { nodes: n, edges: e } = dslToFlow(dslSteps, selectedStepId, setSelectedStepId);
    setNodes(n);
    setEdges(e);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dslSteps, selectedStepId]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  );

  // ── Keyboard delete ──────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedStepId) {
        const focused = document.activeElement;
        if (focused && (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA")) return;
        setDslSteps((prev) => prev.filter((s) => s.id !== selectedStepId));
        setSelectedStepId(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedStepId]);

  // ── Drag-and-drop from palette ───────────────────────────────────────────

  const onDropOnCanvas = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const type = dragTypeRef.current;
    if (!type) return;
    const newId = `${type}-${Date.now()}`;
    const newStep: DslStep = { id: newId, type };
    if (type === "switch") newStep.cases = [];
    if (type === "http") { newStep.method = "GET"; newStep.url = ""; }
    if (type === "human_task") { newStep.assignee = ""; newStep.form = { prompt: "" }; }
    setDslSteps((prev) => [...prev, newStep]);
    setSelectedStepId(newId);
  }, []);

  // ── Property panel update ────────────────────────────────────────────────

  const selectedStep = useMemo(
    () => dslSteps.find((s) => s.id === selectedStepId) ?? null,
    [dslSteps, selectedStepId],
  );

  const handleStepChange = useCallback((updated: DslStep) => {
    setDslSteps((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  // ── Save Draft ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!def) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const dsl: DSL = { id: draftVersion?.dsl?.id ?? "v1", steps: dslSteps };
      const ver = await saveVersion(def.id, { dsl, notes: `Auto-saved draft` });
      setDraftVersion(ver);
      setSaveMsg("Draft saved");
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ── Delete workflow ──────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!def) return;
    setDeleting(true);
    try {
      const { deleteWorkflow } = await import("@/lib/api/workflows");
      await deleteWorkflow(def.id, def.version);
      router.push("/pm/workflows");
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // ── Rename ───────────────────────────────────────────────────────────────

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const handleRename = async () => {
    if (!def || !nameDraft.trim()) { setEditingName(false); return; }
    try {
      const updated = await patchWorkflow(def.id, { name: nameDraft.trim(), version: def.version });
      setDef(updated);
    } catch { /* ignore */ }
    finally { setEditingName(false); }
  };

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Workflows", href: "/pm/workflows" }, { label: "…" }]} />
        <div className="flex flex-1 items-center justify-center text-sm text-ink-3">Loading…</div>
      </div>
    );
  }

  if (!def) {
    return (
      <div className="flex h-full flex-col">
        <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Workflows", href: "/pm/workflows" }, { label: "Not found" }]} />
        <div className="flex flex-1 items-center justify-center text-sm text-danger">Workflow not found.</div>
      </div>
    );
  }

  const statusTone = (s: string) => s === "published" ? "success" : s === "archived" ? "danger" : "neutral";

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[
          { label: "Home", href: "/pm/home" },
          { label: "Workflows", href: "/pm/workflows" },
          { label: def.name },
        ]}
      />
      <CommandBar
        actions={[
          { id: "save", label: saving ? "Saving…" : "Save Draft", icon: <Save size={14} />, onClick: handleSave, disabled: saving },
          { id: "sep1", kind: "separator" },
          {
            id: "publish",
            label: "Publish",
            icon: <Upload size={14} />,
            onClick: () => setShowPublishModal(true),
            disabled: !draftVersion,
          },
          { id: "sep2", kind: "separator" },
          { id: "run", label: "Run Once", icon: <Play size={14} />, onClick: () => setShowRunModal(true) },
          { id: "sep3", kind: "separator" },
          { id: "refresh", label: "Refresh", icon: <RefreshCw size={14} />, onClick: loadDef },
          { id: "sep4", kind: "separator" },
          { id: "delete", label: "Delete", icon: <Trash2 size={14} />, variant: "danger", onClick: () => setShowDeleteConfirm(true) },
        ]}
      />

      {/* Header card */}
      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-3">
        {editingName ? (
          <div className="flex items-center gap-2">
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              autoFocus
              onBlur={handleRename}
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setEditingName(false); }}
              className="text-sm font-semibold"
            />
          </div>
        ) : (
          <button
            type="button"
            className="text-base font-semibold text-ink hover:text-accent"
            onClick={() => { setNameDraft(def.name); setEditingName(true); }}
          >
            {def.name}
          </button>
        )}
        <Tag tone={statusTone(def.status) as "success" | "danger" | "neutral"}>{def.status}</Tag>
        <span className="rounded bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-ink-3">
          v{def.currentVersion}
        </span>
        {draftVersion && (
          <span className="rounded bg-warning/10 px-2 py-0.5 font-mono text-[11px] text-warning">
            draft r{draftVersion.rev}
          </span>
        )}
        {saveMsg && (
          <span className="ml-auto text-xs text-success">{saveMsg}</span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-line bg-paper px-4">
        {(["designer", "versions", "runs"] as Tab[]).map((t) => (
          <button
            type="button"
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors
              ${tab === t
                ? "border-b-2 border-accent text-accent"
                : "text-ink-3 hover:text-ink"
              }`}
          >
            {t === "designer" && <ChevronRight size={13} className="mr-1 inline" />}
            {t === "versions" && <Clock size={13} className="mr-1 inline" />}
            {t === "runs" && <Play size={13} className="mr-1 inline" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex flex-1 overflow-hidden">
        {tab === "designer" && (
          <>
            {/* Palette */}
            <div className="w-48 shrink-0 border-r border-line bg-paper">
              <NodePalette onDragStart={(type) => { dragTypeRef.current = type; }} />
            </div>

            {/* Canvas */}
            <div
              className="relative flex-1"
              onDrop={onDropOnCanvas}
              onDragOver={(e) => e.preventDefault()}
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                fitView
                onPaneClick={() => setSelectedStepId(null)}
                deleteKeyCode={null}
              >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
                <Controls />
                <MiniMap
                  nodeColor={() => "var(--surface-2)"}
                  maskColor="rgba(0,0,0,0.08)"
                  className="rounded border border-line shadow-xs"
                />
              </ReactFlow>
              {dslSteps.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <p className="text-sm text-ink-3">Drag steps from the palette to build your workflow</p>
                </div>
              )}
            </div>

            {/* Property panel */}
            <div className="w-72 shrink-0 border-l border-line bg-paper">
              <div className="border-b border-line px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-3">Properties</span>
              </div>
              <PropPanel step={selectedStep} onChange={handleStepChange} />
            </div>
          </>
        )}

        {tab === "versions" && (
          <VersionsTab
            workflowId={def.id}
            currentVersion={def.currentVersion}
            onPublish={(rev) => {
              // Create a temp draftVersion-like object to get rev
              setDraftVersion((prev) => prev ? { ...prev, rev } : null);
              setShowPublishModal(true);
            }}
            onView={setPreviewVersion}
          />
        )}

        {tab === "runs" && <RunsTab workflowId={def.id} />}
      </div>

      {/* Modals */}
      {showRunModal && (
        <RunOnceModal
          workflowId={def.id}
          onClose={() => setShowRunModal(false)}
          onStarted={(instId) => {
            setShowRunModal(false);
            router.push(`/pm/workflows/${def.id}/runs/${instId}`);
          }}
        />
      )}

      {showPublishModal && draftVersion && (
        <PublishModal
          workflowId={def.id}
          draftRev={draftVersion.rev}
          defVersion={def.version}
          draftStepCount={dslSteps.length}
          onClose={() => setShowPublishModal(false)}
          onPublished={loadDef}
        />
      )}

      {previewVersion && (
        <DslPreviewModal version={previewVersion} onClose={() => setPreviewVersion(null)} />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-sm rounded-lg border border-line bg-paper p-6 shadow-xl">
            <h2 className="mb-2 text-sm font-semibold text-ink">Delete Workflow</h2>
            <p className="mb-4 text-sm text-ink-2">
              Delete <strong>&ldquo;{def.name}&rdquo;</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
