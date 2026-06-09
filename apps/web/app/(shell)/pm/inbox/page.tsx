"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Inbox } from "lucide-react";
import { Button, Tag, Dialog } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { useAuth } from "@/lib/auth/AuthProvider";
import { HumanTaskForm } from "@/components/workflow/HumanTaskForm";
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

type Scope = "mine" | "all";

export default function InboxPage() {
  const { user } = useAuth();
  const meId = user?.id ?? null;

  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("mine");

  // Active task in the completion drawer.
  const [active, setActive] = useState<HumanTask | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Scope to the current user when "mine" and we know who they are.
      const params: { assignee_id?: string; status?: string; limit: number } = { limit: 200 };
      if (scope === "mine" && meId) params.assignee_id = meId;
      const { items } = await listHumanTasks(params);
      setTasks(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [scope, meId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (outcome: string, data: Record<string, unknown>) => {
    if (!active) return;
    setSubmitting(true);
    setDrawerError(null);
    try {
      await completeHumanTask(active.id, { outcome, data });
      setActive(null);
      await load();
    } catch (e) {
      setDrawerError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const isOverdue = (task: HumanTask) =>
    !!task.slaDeadline && !task.completedAt && new Date(task.slaDeadline) < new Date();

  // KPI counts
  const pending  = tasks.filter((t) => !t.outcome).length;
  const overdue  = tasks.filter((t) => isOverdue(t)).length;
  const approved = tasks.filter((t) => t.outcome === "approved").length;
  const rejected = tasks.filter((t) => t.outcome === "rejected").length;

  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) => {
        // pending first, then overdue first, then newest
        const ap = a.outcome ? 1 : 0;
        const bp = b.outcome ? 1 : 0;
        if (ap !== bp) return ap - bp;
        const ao = isOverdue(a) ? 0 : 1;
        const bo = isOverdue(b) ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }),
    [tasks],
  );

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

        {/* Scope toggle */}
        <div className="mb-4 flex items-center gap-2">
          <div className="inline-flex rounded-sm border border-line bg-surface p-0.5">
            {(["mine", "all"] as Scope[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`rounded-[3px] px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  scope === s ? "bg-accent text-white" : "text-ink-3 hover:text-ink"
                }`}
              >
                {s === "mine" ? "Mine" : "All"}
              </button>
            ))}
          </div>
          {scope === "mine" && !meId && (
            <span className="text-[11px] text-ink-3">
              Sign-in not detected — showing all tasks.
            </span>
          )}
        </div>

        {/* KPI strip */}
        <div className="mb-4 grid grid-cols-4 gap-3">
          <KpiTile label="Pending" value={pending} tone="warning" />
          <KpiTile label="Overdue" value={overdue} tone="danger" />
          <KpiTile label="Approved" value={approved} tone="success" />
          <KpiTile label="Rejected" value={rejected} tone="neutral" />
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
                  <th className="px-4 py-2 text-left">Instance</th>
                  <th className="px-4 py-2 text-left">Step</th>
                  <th className="px-4 py-2 text-left">Prompt</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2 text-left">SLA Deadline</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-2 py-2 text-left"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-ink-3">
                      <Inbox size={32} className="mx-auto mb-2 opacity-30" />
                      <p>No tasks found.</p>
                    </td>
                  </tr>
                ) : (
                  sorted.map((task) => {
                    const overdueRow = isOverdue(task);
                    const isPending = !task.outcome;
                    return (
                      <tr
                        key={task.id}
                        className={`border-b border-line last:border-0 hover:bg-surface-2 ${
                          overdueRow ? "bg-danger/[0.04]" : ""
                        }`}
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-ink-3">
                          {task.instanceId ? task.instanceId.slice(0, 8) + "…" : "—"}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-ink">
                          {task.stepId || "—"}
                        </td>
                        <td className="max-w-xs truncate px-4 py-2.5 text-xs text-ink-2">
                          {String(task.form?.prompt ?? task.form?.title ?? "—")}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-ink-3">
                          {fmtDate(task.createdAt)}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-xs ${
                            overdueRow ? "font-medium text-danger" : "text-ink-3"
                          }`}
                        >
                          {fmtDate(task.slaDeadline)}
                          {overdueRow && <span className="ml-1">(overdue)</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {isPending ? (
                            <Tag tone="warning">pending</Tag>
                          ) : (
                            <Tag tone={outcomeTone(task.outcome)}>{task.outcome}</Tag>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {isPending && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setDrawerError(null);
                                setActive(task);
                              }}
                            >
                              Review
                            </Button>
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

      {/* Completion drawer */}
      <Dialog
        open={active != null}
        onClose={() => (submitting ? undefined : setActive(null))}
        size="md"
        title="Complete task"
        description={active ? `${active.stepId} · instance ${active.instanceId.slice(0, 8)}…` : undefined}
      >
        {active && (
          <HumanTaskForm
            task={active}
            submitting={submitting}
            error={drawerError}
            onSubmit={handleSubmit}
          />
        )}
      </Dialog>
    </div>
  );
}
