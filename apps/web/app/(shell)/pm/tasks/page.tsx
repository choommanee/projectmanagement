"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Plus, Download } from "lucide-react";
import { Button, Input, Tag, Dialog, EmptyState, LoadingState } from "@pmplatform/ui-kit";
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

  // ── Computed KPIs from current page ────────────────────────────────────────
  const kpis = useMemo(() => {
    let open = 0, done = 0, blocked = 0, overdue = 0;
    let est = 0, act = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const t of tasks) {
      if (t.status === "done") done++;
      else open++;
      if (t.status === "blocked") blocked++;
      if (t.dueDate && String(t.dueDate).slice(0, 10) < today && t.status !== "done" && t.status !== "cancelled") {
        overdue++;
      }
      est += t.estimateMd ?? 0;
      act += t.actualMd ?? 0;
    }
    return { open, done, blocked, overdue, est, act };
  }, [tasks]);

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

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
          {/* ── Editorial header ─────────────────────────────────────────── */}
          <header className="reveal-up flex items-end justify-between gap-6 border-b border-line pb-5">
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
                ◢ control room · tasks · cross-project
              </div>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
                Tasks
              </h1>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">page</div>
              <div className="font-mono text-[11px] tabular-nums text-ink-2">
                {tasks.length}/{total} · pg {page + 1}
              </div>
            </div>
          </header>

          {/* ── Live instrument strip ────────────────────────────────────── */}
          <section
            className="reveal-up relative overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs"
            aria-label="Task KPIs"
          >
            <div aria-hidden className="pointer-events-none absolute inset-0 blueprint-grid" />
            <div className="relative grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 divide-y divide-line lg:divide-y-0 lg:divide-x">
              {[
                { label: "total",   value: total,         tone: "accent" as const },
                { label: "open",    value: kpis.open,     tone: "accent" as const },
                { label: "done",    value: kpis.done,     tone: "accent" as const },
                { label: "blocked", value: kpis.blocked,  tone: "signal" as const },
                { label: "overdue", value: kpis.overdue,  tone: "signal" as const },
                { label: "est ▸ act", value: `${kpis.est.toFixed(1)} ▸ ${kpis.act.toFixed(1)}md`, tone: "accent" as const },
              ].map((k) => (
                <div key={k.label} className="flex flex-col gap-1 px-4 py-4">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${k.tone === "signal" ? "bg-signal" : "bg-accent"}`} />
                    {k.label}
                  </div>
                  <div className={`font-mono text-[22px] font-semibold leading-none tabular-nums ${k.tone === "signal" && Number(k.value) > 0 ? "text-signal" : "text-ink"}`}>
                    {k.value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Filters row ──────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Filter by status" className="flex flex-wrap items-center gap-1">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === f.value ? "true" : "false"}
                  onClick={() => { setStatusFilter(f.value); setPage(0); }}
                  className={`h-7 rounded-xs px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors ${
                    statusFilter === f.value
                      ? "bg-ink text-paper"
                      : "border border-line-strong bg-surface text-ink-3 hover:border-accent/40 hover:text-ink"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMyTasks((v) => !v)}
                aria-pressed={myTasks ? "true" : "false"}
                className={`h-7 rounded-xs px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors ${
                  myTasks
                    ? "bg-ink text-paper"
                    : "border border-line-strong bg-surface text-ink-3 hover:border-accent/40 hover:text-ink"
                }`}
              >
                My Tasks
              </button>
              <Input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                placeholder="Search…"
                className="w-56 text-sm"
                aria-label="Search tasks"
              />
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          {loading && tasks.length === 0 && (
            <LoadingState rows={5} ariaLabel="Loading tasks" />
          )}

          {!loading && !error && tasks.length === 0 && (
            <EmptyState
              code="◇ no tasks"
              title="No tasks match your filters."
              description="Adjust filters above, toggle My Tasks, or create a new task."
              action={<Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={13} className="mr-1" />New Task</Button>}
            />
          )}

          {!loading && tasks.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <th className="px-3 py-2.5">Code</th>
                    <th className="px-3 py-2.5">Title</th>
                    <th className="px-3 py-2.5">Project</th>
                    <th className="px-3 py-2.5">Type</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Priority</th>
                    <th className="px-3 py-2.5">Assignee</th>
                    <th className="px-3 py-2.5">Est md</th>
                    <th className="px-3 py-2.5">Act md</th>
                    <th className="px-3 py-2.5">Due</th>
                    <th className="px-3 py-2.5">Progress</th>
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
                      <td className="max-w-65 px-3 py-2">
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
              {/* Pagination footer */}
              <div className="flex items-center justify-between border-t border-line bg-paper px-3 py-2 text-[12px] text-ink-3">
                <span className="font-mono tabular-nums">
                  {total} task{total !== 1 ? "s" : ""}{totalPages > 1 ? ` · page ${page + 1} of ${totalPages}` : ""}
                </span>
                {totalPages > 1 && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                      Prev
                    </Button>
                    <Button variant="ghost" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
                      Next
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Task detail sheet */}
      <TaskSheet
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        onChanged={() => void fetchTasks()}
      />

      {/* Create task dialog */}
      <CreateTaskDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => { setShowCreate(false); void fetchTasks(); }}
      />
    </div>
  );
}

// ─── Create task dialog ───────────────────────────────────────────────────────

function CreateTaskDialog({ open, onClose, onCreated }: { open: boolean; onClose(): void; onCreated(): void }) {
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

  const canSubmit = !!title.trim() && !!code.trim() && !!projectId && !busy;
  const fieldLabel = "mb-1 block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3";
  const fieldSelect = "h-9 w-full appearance-none rounded-sm border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New task"
      description="Cross-project quick create · choose project, set basics"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>Create task</Button>
        </>
      }
    >
      <div className="space-y-3">
          <label className="block">
            <span className={fieldLabel}>Project <span className="text-signal">*</span></span>
            <select
              aria-label="Project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className={fieldSelect}
            >
              {projects.length === 0 && <option value="">Loading projects…</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabel}>Code</span>
            <Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" placeholder="T-001" />
          </label>
          <label className="block">
            <span className={fieldLabel}>Title <span className="text-signal">*</span></span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" data-autofocus />
          </label>
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className={fieldLabel}>Type</span>
              <select
                aria-label="Type"
                value={type}
                onChange={(e) => setType(e.target.value as TaskType)}
                className={fieldSelect}
              >
                {(["task","subtask","milestone","deliverable","issue","risk","bug"] as TaskType[]).map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>Status</span>
              <select
                aria-label="Status"
                value={status}
                onChange={(e) => setStatus(e.target.value as TaskStatus)}
                className={fieldSelect}
              >
                {(["todo","in_progress","blocked","review","done","cancelled"] as TaskStatus[]).map((v) => (
                  <option key={v} value={v}>{statusLabel(v)}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>Priority</span>
              <select
                aria-label="Priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className={fieldSelect}
              >
                {(["low","med","high","critical"] as TaskPriority[]).map((v) => (
                  <option key={v} value={v}>{priorityLabel(v)}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block">
            <span className={fieldLabel}>Estimate (md)</span>
            <Input type="number" step="0.5" min="0" value={estimateMd} onChange={(e) => setEstimateMd(e.target.value)} className="font-mono" />
          </label>
          {err && (
            <div role="alert" className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>
          )}
      </div>
    </Dialog>
  );
}
