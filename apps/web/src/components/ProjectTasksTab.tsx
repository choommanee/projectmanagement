"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Plus } from "lucide-react";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import {
  listTasksForProject,
  createTask,
  type Task,
  type TaskStatus,
  type TaskType,
  type TaskPriority,
} from "@/lib/api/tasks";
import { statusTone, priorityTone, statusLabel, priorityLabel } from "@/lib/api/taskTones";
import { TaskSheet } from "./TaskSheet";

// ─── Status filter chips ──────────────────────────────────────────────────────

const STATUS_FILTERS: Array<{ value: TaskStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectTasksTab({ projectId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [search, setSearch] = useState("");

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listTasksForProject(projectId, {
        status: statusFilter || undefined,
        q: search || undefined,
      });
      setTasks(result.items);
      setTotal(result.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, statusFilter, search]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Filter chips */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-xs border px-3 py-1 text-[12px] font-medium transition-colors ${
                statusFilter === f.value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink-2"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-40 text-sm"
          />
          <Button variant="ghost" size="sm" onClick={() => void fetchTasks()}>
            <RefreshCw size={13} />
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={13} />
            New Task
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-sm border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-sm bg-surface-2" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
          <div className="rounded-md border border-dashed border-line px-8 py-6 text-sm text-ink-3">
            No tasks found. Create one to get started.
          </div>
          <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={13} />
            Create first task
          </Button>
        </div>
      )}

      {/* Table */}
      {!loading && tasks.length > 0 && (
        <>
          <div className="overflow-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Priority</th>
                  <th className="px-3 py-2">Est md</th>
                  <th className="px-3 py-2">Act md</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Progress</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task, i) => (
                  <tr
                    key={task.id}
                    onClick={() => setSelectedTaskId(task.id)}
                    className={`cursor-pointer border-b border-line last:border-0 hover:bg-accent-soft/30 transition-colors ${i % 2 === 0 ? "bg-paper" : "bg-surface"}`}
                  >
                    <td className="px-3 py-2">
                      <span className="font-mono text-[12px] text-ink-3">{task.code}</span>
                    </td>
                    <td className="max-w-[280px] px-3 py-2">
                      <span className="block truncate text-ink">{task.title}</span>
                    </td>
                    <td className="px-3 py-2">
                      <Tag tone="neutral">{task.type}</Tag>
                    </td>
                    <td className="px-3 py-2">
                      <Tag tone={statusTone(task.status)} dot>{statusLabel(task.status)}</Tag>
                    </td>
                    <td className="px-3 py-2">
                      <Tag tone={priorityTone(task.priority)}>{priorityLabel(task.priority)}</Tag>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-[12px] tabular-nums text-ink-2">{task.estimateMd}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-[12px] tabular-nums text-ink-2">{task.actualMd}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-[12px] text-ink-2">
                        {task.dueDate ? String(task.dueDate).slice(0, 10) : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                          <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{ width: `${task.progressPct}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] tabular-nums text-ink-3">{task.progressPct}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-right text-[11px] text-ink-3">{total} task{total !== 1 ? "s" : ""}</p>
        </>
      )}

      {/* Task detail sheet */}
      <TaskSheet
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onChanged={() => void fetchTasks()}
      />

      {/* Create task dialog */}
      {showCreate && (
        <CreateTaskDialog
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void fetchTasks(); }}
        />
      )}
    </div>
  );
}

// ─── Create task dialog ───────────────────────────────────────────────────────

function CreateTaskDialog({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string;
  onClose(): void;
  onCreated(): void;
}) {
  const [code, setCode] = useState(`T-${Date.now() % 100000}`);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("task");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("med");
  const [estimateMd, setEstimateMd] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !code.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await createTask(projectId, {
        code: code.trim(),
        title: title.trim(),
        type,
        status,
        priority,
        estimate_md: parseFloat(estimateMd) || 0,
      });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Create task"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md border border-line bg-surface p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold text-ink">New Task</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Code</span>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" placeholder="T-001" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Title <span className="text-signal">*</span></span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" autoFocus />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Type</span>
              <select
                aria-label="Type"
                value={type}
                onChange={(e) => setType(e.target.value as TaskType)}
                className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-2 text-sm text-ink focus:outline-none"
              >
                {(["task","subtask","milestone","deliverable","issue","risk","bug"] as TaskType[]).map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Status</span>
              <select
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-2 text-sm text-ink focus:outline-none"
              >
                {(["todo","in_progress","blocked","review","done","cancelled"] as TaskStatus[]).map((v) => (
                  <option key={v} value={v}>{statusLabel(v)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Priority</span>
              <select
                aria-label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-2 text-sm text-ink focus:outline-none"
              >
                {(["low","med","high","critical"] as TaskPriority[]).map((v) => (
                  <option key={v} value={v}>{priorityLabel(v)}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Estimate (md)</span>
            <Input type="number" step="0.5" min="0" value={estimateMd} onChange={(e) => setEstimateMd(e.target.value)} className="font-mono" />
          </label>
          {err && (
            <div className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              variant="primary"
              disabled={!title.trim() || !code.trim() || busy}
              loading={busy}
              onClick={() => void submit()}
            >
              Create task
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
