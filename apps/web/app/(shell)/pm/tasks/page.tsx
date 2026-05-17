"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Plus, Download } from "lucide-react";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { listAllTasks, createTask, listTasksForProject, type Task, type TaskStatus, type TaskType, type TaskPriority } from "@/lib/api/tasks";
import { listProjects, type Project } from "@/lib/api/projects";
import { statusTone, priorityTone, statusLabel, priorityLabel } from "@/lib/api/taskTones";
import { TaskSheet } from "@/components/TaskSheet";

// ─── Filter chips ─────────────────────────────────────────────────────────────

const STATUS_FILTERS: Array<{ value: TaskStatus | ""; label: string }> = [
  { value: "", label: "All" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
];

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV(tasks: Task[]) {
  const header = ["code", "title", "type", "status", "priority", "projectId", "estimateMd", "actualMd", "dueDate", "progressPct"];
  const rows = tasks.map((t) => [
    t.code, `"${t.title.replace(/"/g, '""')}"`, t.type, t.status, t.priority,
    t.projectId.slice(0, 8), t.estimateMd, t.actualMd,
    t.dueDate ? String(t.dueDate).slice(0, 10) : "", t.progressPct,
  ].join(","));
  const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Initials avatar ──────────────────────────────────────────────────────────

function InitialsAvatar({ id }: { id?: string | null }) {
  if (!id) return <span className="text-[11px] text-ink-3">—</span>;
  const initials = id.slice(0, 2).toUpperCase();
  return (
    <span
      title={id}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft font-mono text-[10px] font-semibold text-accent"
    >
      {initials}
    </span>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<TaskStatus | "">("");
  const [search, setSearch] = useState("");
  const [myTasks, setMyTasks] = useState(false);

  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listAllTasks({
        status: statusFilter || undefined,
        q: search || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setTasks(result.items);
      setTotal(result.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, myTasks, page]);

  useEffect(() => {
    void fetchTasks();
  }, [fetchTasks]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Tasks" }]} />

      <CommandBar
        actions={[
          {
            id: "new",
            label: "+ New Task",
            variant: "primary",
            onClick: () => setShowCreate(true),
          },
          {
            id: "refresh",
            label: "Refresh",
            variant: "ghost",
            icon: <RefreshCw size={13} />,
            onClick: () => void fetchTasks(),
          },
          {
            id: "export",
            label: "Export CSV",
            variant: "ghost",
            icon: <Download size={13} />,
            onClick: () => exportCSV(tasks),
          },
        ]}
      />

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {/* Filters row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => { setStatusFilter(f.value); setPage(0); }}
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
            {/* My Tasks toggle */}
            <button
              type="button"
              onClick={() => setMyTasks((v) => !v)}
              className={`rounded-xs border px-3 py-1 text-[12px] font-medium transition-colors ${
                myTasks
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-surface text-ink-3 hover:border-line-strong hover:text-ink-2"
              }`}
            >
              My Tasks
            </button>
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search…"
              className="w-44 text-sm"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-sm border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 rounded-sm bg-surface-2" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <div className="rounded-md border border-dashed border-line px-8 py-6 text-sm text-ink-3">
              No tasks found. Adjust filters or create a new task.
            </div>
            <Button variant="secondary" size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={13} />
              New Task
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
                    <th className="px-3 py-2">Project</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Priority</th>
                    <th className="px-3 py-2">Assignee</th>
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
                      <td className="max-w-[260px] px-3 py-2">
                        <span className="block truncate text-ink">{task.title}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-[11px] text-ink-3">{task.projectId.slice(0, 8)}</span>
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
                        <InitialsAvatar id={task.assigneeId} />
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between text-[12px] text-ink-3">
                <span>{total} total tasks</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page === 0}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span>Page {page + 1} of {totalPages}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= totalPages - 1}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
            {totalPages <= 1 && (
              <p className="text-right text-[11px] text-ink-3">{total} task{total !== 1 ? "s" : ""}</p>
            )}
          </>
        )}
      </div>

      {/* Task detail sheet */}
      <TaskSheet
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onChanged={() => void fetchTasks()}
      />

      {/* Create task dialog */}
      {showCreate && (
        <CreateTaskDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); void fetchTasks(); }}
        />
      )}
    </div>
  );
}

// ─── Create task dialog ───────────────────────────────────────────────────────

function CreateTaskDialog({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [code, setCode] = useState(`T-${Date.now() % 100000}`);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<TaskType>("task");
  const [status, setStatus] = useState<TaskStatus>("todo");
  const [priority, setPriority] = useState<TaskPriority>("med");
  const [estimateMd, setEstimateMd] = useState("0");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listProjects({ limit: 100 })
      .then((r) => {
        setProjects(r.items);
        if (r.items.length > 0) setProjectId(r.items[0].id);
      })
      .catch(() => {});
  }, []);

  async function submit() {
    if (!title.trim() || !code.trim() || !projectId) return;
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
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Project <span className="text-signal">*</span></span>
            <select
              aria-label="Project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:outline-none"
            >
              {projects.length === 0 && <option value="">Loading projects…</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
          </label>
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
              disabled={!title.trim() || !code.trim() || !projectId || busy}
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
