"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { RefreshCw, Play, XCircle, RotateCcw, PenLine } from "lucide-react";
import Link from "next/link";
import { Button, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { ProcessFlowBar } from "@/shell/ProcessFlowBar";
import {
  getInstance, resumeInstance, cancelInstance, startInstance, retryInstance, completeHumanTask,
  type InstanceDetail, type StepExecution, type HumanTask,
} from "@/lib/api/workflows";
import { HumanTaskForm } from "@/components/workflow/HumanTaskForm";

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
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isPending = !task.outcome;
  const isOverdue = task.slaDeadline && !task.completedAt && new Date(task.slaDeadline) < new Date();

  const handleComplete = async (outcome: string, data: Record<string, unknown>) => {
    setSubmitting(true);
    setActionError(null);
    try {
      await completeHumanTask(task.id, { outcome, data });
      onComplete();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Failed to complete task");
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
          <Tag tone="warning">pending</Tag>
        )}
        {task.assigneeId && (
          <span className="ml-auto text-[11px] text-ink-3">Assigned to: {task.assigneeId.slice(0, 8)}…</span>
        )}
      </div>

      {/* Timing */}
      <div className="mb-3 flex flex-wrap gap-4 text-[11px] text-ink-3">
        <span>Created: {fmtDate(task.createdAt)}</span>
        {task.completedAt && <span>Completed: {fmtDate(task.completedAt)}</span>}
        {task.slaDeadline && (
          <span className={isOverdue ? "font-medium text-danger" : ""}>
            SLA: {fmtDate(task.slaDeadline)}{isOverdue ? " · overdue" : ""}
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

      {/* Pending — schema-driven action form */}
      {isPending && (
        <div className="mt-3 rounded-md border border-line bg-surface-2 p-3">
          <HumanTaskForm
            task={task}
            submitting={submitting}
            error={actionError}
            onSubmit={handleComplete}
          />
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
  const [retrying, setRetrying] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

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

  // Ticking clock for the wake_at countdown while paused on a timer.
  useEffect(() => {
    if (detail?.status !== "paused" || !detail?.wakeAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [detail?.status, detail?.wakeAt]);

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

  const handleRetry = async () => {
    setRetrying(true);
    setActionMsg(null);
    try {
      await retryInstance(instanceId);
      await load();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setRetrying(false);
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

  const isActive = detail.status === "running" || detail.status === "paused";
  const commandActions = [
    { id: "refresh", label: "Refresh", icon: <RefreshCw size={14} />, onClick: load },
    ...(detail.status === "failed" ? [{ id: "retry", label: retrying ? "Retrying…" : "Retry", icon: <RotateCcw size={14} />, onClick: handleRetry, disabled: retrying, variant: "primary" as const }] : []),
    ...(detail.status === "paused" ? [{ id: "resume", label: resuming ? "Resuming…" : "Resume", icon: <Play size={14} />, onClick: handleResume, disabled: resuming, variant: "primary" as const }] : []),
    ...(isActive ? [{ id: "cancel", label: cancelling ? "Cancelling…" : "Cancel", icon: <XCircle size={14} />, onClick: handleCancel, disabled: cancelling, variant: "danger" as const }] : []),
    { id: "sep", kind: "separator" as const },
    { id: "rerun", label: rerunning ? "Starting…" : "Run again with same input", icon: <RotateCcw size={14} />, onClick: handleRerun, disabled: rerunning },
  ];

  const wakeMs = detail.status === "paused" && detail.wakeAt ? new Date(detail.wakeAt).getTime() - now : null;
  const wakeLabel = (() => {
    if (wakeMs == null) return null;
    if (wakeMs <= 0) return "resuming…";
    const s = Math.floor(wakeMs / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  })();

  // Awaiting-signature pause: distinct from a timer pause (wakeAt) and a
  // human-task pause (shown in the Human Tasks tab).
  const awaitingSignature = detail.status === "paused" && !!detail.pendingEnvelopeId;
  const signatureDocId = (() => {
    const inp = detail.input as Record<string, unknown> | null;
    const fromInput = inp && typeof inp === "object" ? inp["document_id"] : null;
    const vars = detail.variables;
    const fromVars = vars && typeof vars === "object" ? (vars as Record<string, unknown>)["document_id"] : null;
    const v = fromInput ?? fromVars;
    return v != null ? String(v) : null;
  })();

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
            <div className="flex items-center gap-2">
              {detail.status === "failed" && (
                <Button variant="primary" size="sm" onClick={handleRetry} disabled={retrying}>
                  <RotateCcw size={14} /> {retrying ? "Retrying…" : "Retry"}
                </Button>
              )}
              {detail.status === "paused" && (
                <Button variant="primary" size="sm" onClick={handleResume} disabled={resuming}>
                  <Play size={14} /> {resuming ? "Resuming…" : "Resume Instance"}
                </Button>
              )}
              {isActive && (
                <Button variant="danger" size="sm" onClick={handleCancel} disabled={cancelling}>
                  <XCircle size={14} /> {cancelling ? "Cancelling…" : "Cancel"}
                </Button>
              )}
            </div>
          </div>

          {/* Awaiting-signature banner */}
          {awaitingSignature && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-signal/40 bg-signal/5 px-3 py-2.5 text-xs">
              <PenLine size={15} className="text-signal" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-signal">⏳ รอลงนามเอกสาร / Awaiting signature</p>
                <p className="mt-0.5 text-ink-3">
                  Envelope <span className="font-mono text-ink-2">{detail.pendingEnvelopeId?.slice(0, 8)}…</span>
                  {" "}is waiting to be signed. The run resumes automatically once all signers complete (or it declines).
                </p>
              </div>
              {signatureDocId ? (
                <Link
                  href={`/docs/documents/${signatureDocId}?tab=signatures`}
                  className="shrink-0 rounded border border-signal/40 bg-signal/10 px-3 py-1.5 font-medium text-signal hover:bg-signal/15"
                >
                  เปิดเพื่อลงนาม / Open to sign
                </Link>
              ) : (
                <span className="shrink-0 text-ink-3">No document linked</span>
              )}
            </div>
          )}

          {/* Paused-on-timer banner */}
          {!awaitingSignature && wakeLabel && (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
              <span className="font-medium">Paused on timer</span>
              <span className="text-ink-3">
                resumes at {fmtDate(detail.wakeAt)} · in <span className="font-mono tabular-nums text-ink-2">{wakeLabel}</span>
              </span>
            </div>
          )}

          {/* Failure banner with retry */}
          {detail.status === "failed" && detail.error && (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-danger bg-danger/10 px-3 py-2 text-xs text-danger">
              <div>
                <span className="font-semibold">Instance failed</span>
                <p className="mt-0.5 font-mono text-[11px] leading-relaxed">{detail.error}</p>
                {detail.cursor && <p className="mt-1 text-[11px] text-ink-3">Will retry from step: <span className="font-mono text-ink-2">{detail.cursor}</span></p>}
              </div>
              <Button variant="primary" size="sm" onClick={handleRetry} disabled={retrying} className="shrink-0">
                <RotateCcw size={14} /> {retrying ? "Retrying…" : "Retry"}
              </Button>
            </div>
          )}

          {detail.error && detail.status !== "failed" && (
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
