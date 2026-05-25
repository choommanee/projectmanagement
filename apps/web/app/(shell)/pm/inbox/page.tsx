"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, CheckCircle, ChevronRight } from "lucide-react";
import { Button, Tag, TextArea } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listHumanTasks, completeHumanTask, getInstance,
  type HumanTask, type WorkflowInstance,
} from "@/lib/api/workflows";
import { useAuth } from "@/lib/auth/AuthProvider";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function readUserMeta(): { id?: string } {
  try {
    const raw = document.cookie.split(";").find((c) => c.trim().startsWith("user_meta="))?.split("=")[1];
    if (!raw) return {};
    return JSON.parse(atob(raw));
  } catch {
    return {};
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

interface ToastProps { message: string; onDone: () => void }

function Toast({ message, onDone }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-success bg-success/10 px-4 py-3 shadow-xl text-sm text-success">
      <CheckCircle size={16} />
      {message}
    </div>
  );
}

// ─── Complete slide-over ──────────────────────────────────────────────────────

const OUTCOMES = ["approve", "reject", "needs_info"];

interface CompleteSheetProps {
  task: HumanTask;
  instanceInfo: WorkflowInstance | null;
  onClose: () => void;
  onCompleted: () => void;
}

function CompleteSheet({ task, instanceInfo, onClose, onCompleted }: CompleteSheetProps) {
  const [outcome, setOutcome] = useState("approve");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prompt = String(task.form?.prompt ?? "Please review and respond.");
  const fields = Array.isArray(task.form?.fields) ? task.form.fields as Array<{ name: string; label: string; type: string }> : [];

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await completeHumanTask(task.id, {
        outcome,
        data: { comment: comment.trim() || undefined },
      });
      onCompleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const isOverdue = task.slaDeadline && !task.completedAt && new Date(task.slaDeadline) < new Date();

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-line bg-paper shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Complete Task</h2>
            <p className="text-xs text-ink-3">Step: <span className="font-mono">{task.stepId}</span></p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-ink-3 hover:text-ink">
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Instance context */}
          {instanceInfo && (
            <div className="rounded-md border border-line bg-surface-2 px-3 py-2 text-xs text-ink-3">
              Instance: <span className="font-mono">{instanceInfo.id.slice(0, 12)}</span>
              {" · "}
              <Tag tone="warning">{instanceInfo.status}</Tag>
            </div>
          )}

          {/* Prompt */}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-3">Prompt</p>
            <p className="text-sm text-ink">{prompt}</p>
          </div>

          {/* SLA */}
          {task.slaDeadline && (
            <p className={`text-xs ${isOverdue ? "text-danger font-medium" : "text-ink-3"}`}>
              SLA deadline: {fmtDate(task.slaDeadline)}{isOverdue ? " — OVERDUE" : ""}
            </p>
          )}

          {/* Dynamic form fields */}
          {fields.map((field) => (
            <div key={field.name}>
              <label className="mb-1 block text-xs font-medium text-ink-2">{field.label}</label>
              <input
                type={field.type === "number" ? "number" : "text"}
                className="w-full rounded border border-line bg-paper px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
                placeholder={field.label}
              />
            </div>
          ))}

          {/* Outcome */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-3">Outcome</label>
            <div className="flex gap-2">
              {OUTCOMES.map((o) => (
                <button
                  type="button"
                  key={o}
                  onClick={() => setOutcome(o)}
                  className={`flex-1 rounded border py-1.5 text-xs font-medium capitalize transition-colors
                    ${outcome === o
                      ? "border-accent bg-accent text-white"
                      : "border-line bg-paper text-ink-2 hover:border-accent/50 hover:text-ink"
                    }`}
                >
                  {o.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {/* Comment */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-3">Comment</label>
            <TextArea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder="Optional comment…"
            />
          </div>

          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting}>
            <CheckCircle size={13} />
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [myTasksOnly, setMyTasksOnly] = useState(false);
  const [selectedTask, setSelectedTask] = useState<HumanTask | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<WorkflowInstance | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { status: string; assignee_id?: string; limit: number } = {
        status: "open",
        limit: 100,
      };
      if (myTasksOnly && user?.id) {
        params.assignee_id = user.id;
      }
      const { items, total: t } = await listHumanTasks(params);
      setTasks(items);
      setTotal(t);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [myTasksOnly, user]);

  useEffect(() => { load(); }, [load]);

  const handleRowClick = async (task: HumanTask) => {
    setSelectedTask(task);
    setSelectedInstance(null);
    setError(null);
    try {
      const detail = await getInstance(task.instanceId);
      setSelectedInstance(detail);
    } catch (e) { setError((e as Error).message); }
  };

  const handleCompleted = async () => {
    setSelectedTask(null);
    setSelectedInstance(null);
    setToast("Task completed; instance resumed.");
    await load();
  };

  const isOverdue = (task: HumanTask) =>
    !!task.slaDeadline && !task.completedAt && new Date(task.slaDeadline) < new Date();

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "My Tasks (Approvals)" }]} />
      <CommandBar
        actions={[
          { id: "refresh", label: "Refresh", icon: <RefreshCw size={14} />, onClick: load },
        ]}
      />

      <div className="flex flex-1 flex-col overflow-auto p-4">
        {error && (
          <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
            {error}
          </div>
        )}
        {/* Filter toggle */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex rounded-md border border-line overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setMyTasksOnly(false)}
              className={`px-3 py-1.5 font-medium transition-colors
                ${!myTasksOnly ? "bg-accent text-white" : "bg-paper text-ink-2 hover:bg-surface-2"}`}
            >
              All Open Tasks
            </button>
            <button
              type="button"
              onClick={() => setMyTasksOnly(true)}
              className={`px-3 py-1.5 font-medium transition-colors border-l border-line
                ${myTasksOnly ? "bg-accent text-white" : "bg-paper text-ink-2 hover:bg-surface-2"}`}
            >
              My Tasks
            </button>
          </div>
          <span className="text-xs text-ink-3">{total} open task{total !== 1 ? "s" : ""}</span>
        </div>

        {loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-3">Loading…</div>
        )}

        {!loading && (
          <div className="overflow-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2 text-left">Step</th>
                  <th className="px-4 py-2 text-left">Prompt</th>
                  <th className="px-4 py-2 text-left">SLA Deadline</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2 text-left"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {tasks.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-ink-3">
                      <CheckCircle size={32} className="mx-auto mb-2 opacity-30" />
                      <p>No pending tasks. You&apos;re all caught up.</p>
                    </td>
                  </tr>
                )}
                {tasks.map((task) => {
                  const overdue = isOverdue(task);
                  return (
                    <tr
                      key={task.id}
                      className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
                      onClick={() => handleRowClick(task)}
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-ink">{task.stepId}</span>
                      </td>
                      <td className="max-w-xs truncate px-4 py-2.5 text-xs text-ink-2">
                        {String(task.form?.prompt ?? "—")}
                      </td>
                      <td className={`px-4 py-2.5 text-xs ${overdue ? "text-danger font-medium" : "text-ink-3"}`}>
                        {fmtDate(task.slaDeadline)}
                        {overdue && <span className="ml-1">(overdue)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-3">{fmtDate(task.createdAt)}</td>
                      <td className="px-4 py-2.5">
                        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); handleRowClick(task); }}>
                          Complete
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedTask && (
        <CompleteSheet
          task={selectedTask}
          instanceInfo={selectedInstance}
          onClose={() => { setSelectedTask(null); setSelectedInstance(null); }}
          onCompleted={handleCompleted}
        />
      )}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
