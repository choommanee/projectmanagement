"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, CheckCircle, XCircle, Inbox } from "lucide-react";
import { Button, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listHumanTasks,
  completeHumanTask,
  type HumanTask,
} from "@/lib/api/workflows";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function outcomeTone(outcome: string | null): "success" | "danger" | "warning" | "neutral" {
  if (outcome === "approved") return "success";
  if (outcome === "rejected") return "danger";
  if (outcome === "needs_info") return "warning";
  return "neutral";
}

// ─── KPI tile ─────────────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "warning" | "success" | "danger" | "neutral";
}) {
  const toneClass: Record<string, string> = {
    warning: "border-warning/30 bg-warning/5 text-warning",
    success: "border-success/30 bg-success/5 text-success",
    danger:  "border-danger/30  bg-danger/5  text-danger",
    neutral: "border-line       bg-surface   text-ink-2",
  };
  return (
    <div className={`rounded-sm border px-4 py-3 ${toneClass[tone]}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] opacity-70">{label}</div>
      <div className="mt-1 font-mono text-2xl tabular-nums">{value}</div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items } = await listHumanTasks({ limit: 200 });
      setTasks(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleComplete = async (id: string, outcome: "approved" | "rejected") => {
    setCompleting((prev) => ({ ...prev, [id]: true }));
    try {
      await completeHumanTask(id, { outcome, data: {} });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCompleting((prev) => ({ ...prev, [id]: false }));
    }
  };

  // KPI counts
  const pending  = tasks.filter((t) => !t.outcome).length;
  const approved = tasks.filter((t) => t.outcome === "approved").length;
  const rejected = tasks.filter((t) => t.outcome === "rejected").length;

  const isOverdue = (task: HumanTask) =>
    !!task.slaDeadline && !task.completedAt && new Date(task.slaDeadline) < new Date();

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[{ label: "Home", href: "/pm/home" }, { label: "My Tasks (Approvals)" }]}
      />
      <CommandBar
        actions={[
          {
            id: "refresh",
            label: "Refresh",
            icon: <RefreshCw size={14} />,
            onClick: load,
          },
        ]}
      />

      <div className="flex flex-1 flex-col overflow-auto p-4">
        {error && (
          <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
            {error}
          </div>
        )}

        {/* KPI strip */}
        <div className="mb-4 grid grid-cols-3 gap-3">
          <KpiTile label="Pending" value={pending} tone="warning" />
          <KpiTile label="Approved" value={approved} tone="success" />
          <KpiTile label="Rejected" value={rejected} tone="danger" />
        </div>

        {/* Table */}
        {loading ? (
          <div className="space-y-px">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <div className="overflow-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-xs font-semibold uppercase tracking-[0.06em] text-ink-3">
                  <th className="px-4 py-2 text-left">Workflow</th>
                  <th className="px-4 py-2 text-left">Step</th>
                  <th className="px-4 py-2 text-left">Prompt</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2 text-left">SLA Deadline</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-ink-3">
                      <Inbox size={32} className="mx-auto mb-2 opacity-30" />
                      <p>No tasks found. You have no pending approvals.</p>
                    </td>
                  </tr>
                ) : (
                  tasks.map((task) => {
                    const overdue = isOverdue(task);
                    const isPending = !task.outcome;
                    const busy = completing[task.id] ?? false;
                    return (
                      <tr
                        key={task.id}
                        className="border-b border-line last:border-0 hover:bg-surface-2"
                      >
                        {/* Workflow — instanceId truncated as proxy */}
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-3">
                          {task.instanceId ? task.instanceId.slice(0, 8) + "…" : "—"}
                        </td>
                        {/* Step */}
                        <td className="px-4 py-2.5 font-mono text-xs text-ink">
                          {task.stepId || "—"}
                        </td>
                        {/* Prompt */}
                        <td className="max-w-xs truncate px-4 py-2.5 text-xs text-ink-2">
                          {String(task.form?.prompt ?? "—")}
                        </td>
                        {/* Created */}
                        <td className="px-4 py-2.5 text-xs text-ink-3">
                          {fmtDate(task.createdAt)}
                        </td>
                        {/* SLA Deadline */}
                        <td
                          className={`px-4 py-2.5 text-xs ${
                            overdue ? "font-medium text-danger" : "text-ink-3"
                          }`}
                        >
                          {fmtDate(task.slaDeadline)}
                          {overdue && <span className="ml-1">(overdue)</span>}
                        </td>
                        {/* Status */}
                        <td className="px-4 py-2.5">
                          {isPending ? (
                            <Tag tone="warning">pending</Tag>
                          ) : (
                            <Tag tone={outcomeTone(task.outcome)}>{task.outcome}</Tag>
                          )}
                        </td>
                        {/* Actions */}
                        <td className="px-4 py-2.5">
                          {isPending && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                title="Approve"
                                disabled={busy}
                                onClick={() => handleComplete(task.id, "approved")}
                                className="flex items-center gap-1 rounded border border-success/40 bg-success/5 px-2 py-1 text-[11px] font-medium text-success transition-colors hover:bg-success/15 disabled:opacity-50"
                              >
                                <CheckCircle size={12} />
                                Approve
                              </button>
                              <button
                                type="button"
                                title="Reject"
                                disabled={busy}
                                onClick={() => handleComplete(task.id, "rejected")}
                                className="flex items-center gap-1 rounded border border-danger/40 bg-danger/5 px-2 py-1 text-[11px] font-medium text-danger transition-colors hover:bg-danger/15 disabled:opacity-50"
                              >
                                <XCircle size={12} />
                                Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
