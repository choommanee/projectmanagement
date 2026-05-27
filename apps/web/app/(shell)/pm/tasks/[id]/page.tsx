"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getTask, updateTask, type Task, type TaskStatus, type TaskPriority } from "@/lib/api/tasks";

const statusColors: Record<TaskStatus, string> = {
  todo:        "bg-muted text-muted-foreground",
  in_progress: "bg-blue-100 text-blue-800",
  blocked:     "bg-red-100 text-red-800",
  review:      "bg-yellow-100 text-yellow-800",
  done:        "bg-green-100 text-green-800",
  cancelled:   "bg-gray-200 text-gray-500",
};

const priorityColors: Record<TaskPriority, string> = {
  low:      "bg-gray-100 text-gray-600",
  med:      "bg-blue-100 text-blue-700",
  high:     "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "review", "done", "cancelled"];

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getTask(id).then(setTask).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  async function handleStatus(status: TaskStatus) {
    if (!task) return;
    setSaving(true);
    try {
      const updated = await updateTask(task.id, { status, version: task.version });
      setTask(updated);
    } finally {
      setSaving(false);
    }
  }

  async function handlePriority(priority: TaskPriority) {
    if (!task) return;
    setSaving(true);
    try {
      const updated = await updateTask(task.id, { priority, version: task.version });
      setTask(updated);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!task)   return <div className="p-8 text-destructive">Task not found.</div>;

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb nav */}
      <nav className="text-sm text-muted-foreground">
        <button onClick={() => router.back()} className="hover:underline">← Back</button>
      </nav>

      {/* Header card */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${statusColors[task.status]}`}>
                {task.status.replace("_", " ")}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${priorityColors[task.priority]}`}>
                {task.priority}
              </span>
              <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground capitalize">
                {task.type}
              </span>
              {task.code && (
                <span className="font-mono text-xs text-muted-foreground">{task.code}</span>
              )}
            </div>
            <h1 className="text-2xl font-semibold">{task.title}</h1>
          </div>
        </div>
        {task.description && (
          <p className="mt-3 text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
        )}
      </div>

      {/* Status transitions */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Move to Status
        </p>
        <div className="flex flex-wrap gap-2">
          {STATUSES.filter((s) => s !== task.status).map((s) => (
            <button
              key={s}
              onClick={() => handleStatus(s)}
              disabled={saving}
              className="px-3 py-1 text-xs rounded border border-border hover:bg-muted disabled:opacity-50 capitalize"
            >
              {s.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Priority selector */}
      <div className="rounded-lg border border-border bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
          Priority
        </p>
        <div className="flex flex-wrap gap-2">
          {(["low", "med", "high", "critical"] as TaskPriority[]).filter((p) => p !== task.priority).map((p) => (
            <button
              key={p}
              onClick={() => handlePriority(p)}
              disabled={saving}
              className={`px-3 py-1 text-xs rounded border border-border hover:bg-muted disabled:opacity-50 capitalize ${priorityColors[p]}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: "Status",   value: task.status.replace("_", " ") },
          { label: "Priority", value: task.priority },
          { label: "Type",     value: task.type },
          { label: "Project",  value: task.projectId ?? "—" },
          { label: "Assignee", value: task.assigneeId ?? "—" },
          { label: "Due Date", value: task.dueDate ? String(task.dueDate).slice(0, 10) : "—" },
          { label: "Estimate", value: task.estimateMd != null ? `${task.estimateMd} md` : "—" },
          { label: "Actual",   value: task.actualMd != null ? `${task.actualMd} md` : "—" },
          { label: "Progress", value: task.progressPct != null ? `${task.progressPct}%` : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-medium capitalize">{value}</p>
          </div>
        ))}
      </div>

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Tags</p>
          <div className="flex flex-wrap gap-2">
            {task.tags.map((tag) => (
              <span key={tag} className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="text-xs text-muted-foreground space-y-1">
        <p>Created: {task.createdAt ? task.createdAt.slice(0, 10) : "—"}</p>
        <p>Updated: {task.updatedAt ? task.updatedAt.slice(0, 10) : "—"}</p>
      </div>
    </div>
  );
}
