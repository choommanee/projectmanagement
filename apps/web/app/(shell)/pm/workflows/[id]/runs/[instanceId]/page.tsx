"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { RefreshCw, Play, XCircle, RotateCcw } from "lucide-react";
import { Button, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { ProcessFlowBar } from "@/shell/ProcessFlowBar";
import {
  getInstance, resumeInstance, cancelInstance, startInstance, completeHumanTask,
  type InstanceDetail, type StepExecution, type HumanTask,
} from "@/lib/api/workflows";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type InstanceStatus = InstanceDetail["status"];
type StepStatus = StepExecution["status"];

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start) return "—";
  const endTime = end ? new Date(end).getTime() : Date.now();
  const ms = endTime - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function instTone(s: InstanceStatus): "info" | "success" | "danger" | "warning" | "neutral" {
  if (s === "completed") return "success";
  if (s === "failed") return "danger";
  if (s === "running") return "info";
  if (s === "paused") return "warning";
  return "neutral";
}

function stepTone(s: StepStatus): "info" | "success" | "danger" | "warning" | "neutral" {
  if (s === "completed") return "success";
  if (s === "failed") return "danger";
  if (s === "running") return "info";
  if (s === "skipped") return "neutral";
  return "neutral";
}

const FLOW_STAGES = [
  { id: "running", label: "Running" },
  { id: "paused", label: "Paused" },
  { id: "completed", label: "Completed" },
];

function JsonBlock({ value }: { value: unknown }) {
  const text = value == null ? "null" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="overflow-auto rounded-md bg-surface-2 p-3 font-mono text-[11px] text-ink-2 max-h-64">
      {text}
    </pre>
  );
}

// ─── Steps timeline ───────────────────────────────────────────────────────────

function StepsTab({ steps }: { steps: StepExecution[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sorted = [...steps].sort((a, b) => {
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
  });

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="divide-y divide-line">
      {sorted.map((step) => (
        <div key={step.id} className="hover:bg-surface-2">
          <button
            type="button"
            className="flex w-full items-center gap-3 px-4 py-3 text-left"
            onClick={() => toggle(step.id)}
          >
            <span className="w-5 text-center text-xs text-ink-3">
              {expanded.has(step.id) ? "▾" : "▸"}
            </span>
            <span className="w-40 shrink-0 font-mono text-xs text-ink">{step.stepId}</span>
            <Tag tone={stepTone(step.status)}>{step.stepType}</Tag>
            <Tag tone={stepTone(step.status)}>{step.status}</Tag>
            <span className="ml-auto text-xs text-ink-3">
              {fmtDuration(step.startedAt, step.endedAt)}
            </span>
          </button>
          {expanded.has(step.id) && (
            <div className="grid grid-cols-2 gap-3 px-10 pb-3">
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Input</p>
                <JsonBlock value={step.input} />
              </div>
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Output</p>
                <JsonBlock value={step.output} />
              </div>
              {step.error && (
                <div className="col-span-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-danger">Error</p>
                  <pre className="overflow-auto rounded-md bg-danger/10 p-3 font-mono text-[11px] text-danger">{step.error}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {sorted.length === 0 && (
        <p className="px-4 py-8 text-center text-xs text-ink-3">No step executions recorded.</p>
      )}
    </div>
  );
}

// ─── Human tasks tab ──────────────────────────────────────────────────────────

function HumanTaskCard({ task, onComplete }: { task: HumanTask; onComplete: () => void }) {
  const [responseJson, setResponseJson] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isPending = !task.outcome;
  const isOverdue = task.slaDeadline && !task.completedAt && new Date(task.slaDeadline) < new Date();

  const handleComplete = async (outcome: string) => {
    let data: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(responseJson);
      data = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON in response data");
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      await completeHumanTask(task.id, { outcome, data });
      onComplete();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to complete task");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`rounded-md border bg-paper p-4 ${isPending ? "border-warning/40" : "border-line"}`}>
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-xs font-medium text-ink">{task.stepId}</span>
        {task.outcome ? (
          <Tag tone={task.outcome === "rejected" ? "danger" : "success"}>{task.outcome}</Tag>
        ) : (
          <Tag tone="warning">pending approval</Tag>
        )}
        {task.assigneeId && (
          <span className="ml-auto text-[11px] text-ink-3">Assigned to: {task.assigneeId.slice(0, 8)}…</span>
        )}
      </div>

      {/* Prompt */}
      {task.form?.prompt != null && (
        <p className="mb-3 text-sm text-ink leading-relaxed">{String(task.form.prompt)}</p>
      )}

      {/* Form fields from DSL */}
      {task.form && Object.keys(task.form).filter(k => k !== "prompt").length > 0 && (
        <div className="mb-3 space-y-1">
          {Object.entries(task.form).filter(([k]) => k !== "prompt").map(([k, v]) => (
            <div key={k} className="flex gap-2 text-xs">
              <span className="w-28 shrink-0 font-medium text-ink-3">{k}</span>
              <span className="text-ink">{String(v)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Timing */}
      <div className="mb-3 flex flex-wrap gap-4 text-[11px] text-ink-3">
        <span>Created: {fmtDate(task.createdAt)}</span>
        {task.completedAt && <span>Completed: {fmtDate(task.completedAt)}</span>}
        {task.slaDeadline && (
          <span className={isOverdue ? "font-medium text-danger" : ""}>
            SLA: {fmtDate(task.slaDeadline)}{isOverdue ? " ⚠ overdue" : ""}
          </span>
        )}
      </div>

      {/* Completed response */}
      {task.data && !isPending && (
        <div className="mb-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">Response</p>
          <JsonBlock value={task.data} />
        </div>
      )}

      {/* Pending — action area */}
      {isPending && (
        <div className="mt-3 space-y-3 rounded-md border border-line bg-surface-2 p-3">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-3">
              Response data (JSON, optional)
            </label>
            <textarea
              value={responseJson}
              onChange={(e) => { setResponseJson(e.target.value); setJsonError(null); }}
              rows={3}
              className="w-full rounded-sm border border-line bg-paper px-2 py-1.5 font-mono text-[11px] text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
              placeholder='{"comment": "looks good"}'
            />
            {jsonError && <p className="mt-0.5 text-[11px] text-danger">{jsonError}</p>}
          </div>
          {actionError && (
            <p className="rounded-sm border border-danger/30 bg-danger/5 px-2 py-1 text-[11px] text-danger">{actionError}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={submitting}
              onClick={() => handleComplete("approved")}
            >
              {submitting ? "Submitting…" : "✓ Approve"}
            </Button>
            <Button
              size="sm"
              onClick={() => handleComplete("rejected")}
              disabled={submitting}
              className="border-danger/30 text-danger hover:bg-danger/5 hover:border-danger"
            >
              ✗ Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HumanTasksTab({ tasks, onComplete }: { tasks: HumanTask[]; onComplete: () => void }) {
  if (tasks.length === 0) {
    return <p className="px-4 py-8 text-center text-xs text-ink-3">No human tasks for this run.</p>;
  }
  return (
    <div className="space-y-3 p-4">
      {tasks.map((t) => (
        <HumanTaskCard key={t.id} task={t} onComplete={onComplete} />
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type RunTab = "steps" | "variables" | "io" | "human-tasks";

export default function RunViewerPage() {
  const { id: workflowId, instanceId } = useParams<{ id: string; instanceId: string }>();
  const router = useRouter();

  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<RunTab>("steps");
  const [resuming, setResuming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getInstance(instanceId);
      setDetail(d);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [instanceId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!detail || detail.status === "completed" || detail.status === "failed" || detail.status === "cancelled") return;
    const timer = setInterval(() => { load(); }, 3000);
    return () => clearInterval(timer);
  }, [detail?.status, load]);

  const handleResume = async () => {
    setResuming(true);
    try {
      await resumeInstance(instanceId, {});
      await load();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Resume failed");
    } finally {
      setResuming(false);
    }
  };

  const handleCancel = async () => {
    setCancelling(true);
    try {
      await cancelInstance(instanceId);
      await load();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  };

  const handleRerun = async () => {
    if (!detail) return;
    setRerunning(true);
    try {
      const newInst = await startInstance(workflowId, { input: detail.input });
      router.push(`/pm/workflows/${workflowId}/runs/${newInst.id}`);
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Rerun failed");
    } finally {
      setRerunning(false);
    }
  };

  const breadcrumbItems = [
    { label: "Home", href: "/pm/home" },
    { label: "Workflows", href: "/pm/workflows" },
    { label: workflowId?.slice(0, 8) ?? "…", href: `/pm/workflows/${workflowId}` },
    { label: `Run ${instanceId?.slice(0, 8) ?? "…"}` },
  ];

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <Breadcrumb items={breadcrumbItems} />
        <div className="flex flex-1 items-center justify-center text-sm text-ink-3">Loading…</div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col">
        <Breadcrumb items={breadcrumbItems} />
        <div className="flex flex-1 items-center justify-center text-sm text-danger">Instance not found.</div>
      </div>
    );
  }

  const commandActions = [
    { id: "refresh", label: "Refresh", icon: <RefreshCw size={14} />, onClick: load },
    ...(detail.status === "paused" ? [{ id: "resume", label: resuming ? "Resuming…" : "Resume", icon: <Play size={14} />, onClick: handleResume, disabled: resuming, variant: "primary" as const }] : []),
    ...(detail.status === "running" ? [{ id: "cancel", label: cancelling ? "Cancelling…" : "Cancel", icon: <XCircle size={14} />, onClick: handleCancel, disabled: cancelling, variant: "danger" as const }] : []),
    { id: "sep", kind: "separator" as const },
    { id: "rerun", label: rerunning ? "Starting…" : "Run again with same input", icon: <RotateCcw size={14} />, onClick: handleRerun, disabled: rerunning },
  ];

  const flowStage = detail.status === "completed" ? "completed"
    : detail.status === "paused" ? "paused"
    : detail.status === "running" ? "running"
    : "running";

  const tabs: { id: RunTab; label: string }[] = [
    { id: "steps", label: `Steps (${detail.steps.length})` },
    { id: "variables", label: "Variables" },
    { id: "io", label: "Input / Output" },
    { id: "human-tasks", label: `Human Tasks (${detail.human_tasks.length})` },
  ];

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={breadcrumbItems} />
      <CommandBar actions={commandActions} />

      <div className="flex flex-col gap-4 overflow-auto p-4">
        {/* Header card */}
        <div className="rounded-md border border-line bg-paper p-4">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-ink">{detail.id}</span>
                <Tag tone={instTone(detail.status)}>{detail.status}</Tag>
                <span className="text-xs text-ink-3">{detail.triggerKind || "manual"}</span>
              </div>
              <div className="mt-1 flex gap-4 text-xs text-ink-3">
                <span>Started: {fmtDate(detail.startedAt)}</span>
                <span>Ended: {fmtDate(detail.endedAt)}</span>
                <span>Duration: {fmtDuration(detail.startedAt, detail.endedAt)}</span>
              </div>
            </div>
            {detail.status === "paused" && (
              <Button variant="primary" size="sm" onClick={handleResume} disabled={resuming}>
                <Play size={14} /> {resuming ? "Resuming…" : "Resume Instance"}
              </Button>
            )}
          </div>

          {detail.error && (
            <div className="mb-3 rounded-md border border-danger bg-danger/10 px-3 py-2 text-xs text-danger">
              {detail.error}
            </div>
          )}

          <ProcessFlowBar stages={FLOW_STAGES} current={flowStage} />
        </div>

        {actionMsg && (
          <div className="rounded-md border border-danger bg-danger/10 px-3 py-2 text-xs text-danger">{actionMsg}</div>
        )}

        {/* Tabs */}
        <div className="flex flex-col overflow-hidden rounded-md border border-line bg-paper">
          <div className="flex items-center gap-0 border-b border-line">
            {tabs.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors
                  ${tab === t.id
                    ? "border-b-2 border-accent text-accent"
                    : "text-ink-3 hover:text-ink"
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="min-h-64 overflow-auto">
            {tab === "steps" && <StepsTab steps={detail.steps} />}

            {tab === "variables" && (
              <div className="p-4">
                <JsonBlock value={detail.variables} />
              </div>
            )}

            {tab === "io" && (
              <div className="grid grid-cols-2 gap-4 p-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Input</p>
                  <JsonBlock value={detail.input} />
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">Output</p>
                  <JsonBlock value={detail.output} />
                </div>
              </div>
            )}

            {tab === "human-tasks" && <HumanTasksTab tasks={detail.human_tasks} onComplete={load} />}
          </div>
        </div>
      </div>
    </div>
  );
}
