"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Clock, MessageCircle, Pencil, TrendingUp } from "lucide-react";
import { getTask, updateTask, type Task, type TaskStatus, type TaskPriority } from "@/lib/api/tasks";
import { useAuth } from "@/lib/auth/AuthProvider";
import { RunWorkflowButton } from "@/components/RunWorkflowButton";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Comment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

interface Activity {
  id: string;
  actorId?: string;
  kind: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusColors: Record<TaskStatus, string> = {
  todo:        "bg-surface-2 text-ink-3",
  in_progress: "bg-accent/10 text-accent",
  blocked:     "bg-danger/10 text-danger",
  review:      "bg-warning/10 text-warning",
  done:        "bg-success/10 text-success",
  cancelled:   "bg-surface-2 text-ink-3",
};

const priorityColors: Record<TaskPriority, string> = {
  low:      "border-line text-ink-3",
  med:      "border-line text-ink-2",
  high:     "border-warning/40 text-warning",
  critical: "border-danger/40 text-danger",
};

const STATUSES: TaskStatus[] = ["todo", "in_progress", "blocked", "review", "done", "cancelled"];

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function activityLabel(a: Activity): string {
  switch (a.kind) {
    case "status_changed": return `Status changed: ${a.oldValue} → ${a.newValue}`;
    case "priority_changed": return `Priority changed: ${a.oldValue} → ${a.newValue}`;
    case "assigned": return `Assigned to ${a.newValue || "someone"}`;
    case "commented": return `Commented`;
    default: return a.kind;
  }
}

function activityIcon(kind: string) {
  switch (kind) {
    case "status_changed": return <TrendingUp size={12} className="text-accent" />;
    case "priority_changed": return <Pencil size={12} className="text-warning" />;
    case "assigned": return <CheckCircle2 size={12} className="text-success" />;
    case "commented": return <MessageCircle size={12} className="text-ink-3" />;
    default: return <Clock size={12} className="text-ink-3" />;
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "details" | "activity";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("details");

  const [comments, setComments] = useState<Comment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const activityLoaded = useRef(false);

  useEffect(() => {
    if (!id) return;
    getTask(id).then(setTask).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  const loadActivity = useCallback(async () => {
    if (!id) return;
    setActivityLoading(true);
    try {
      const [cRes, aRes] = await Promise.all([
        fetch(`/api/tasks/${id}/comments`),
        fetch(`/api/tasks/${id}/activity`),
      ]);
      const [cData, aData] = await Promise.all([cRes.json(), aRes.json()]);
      setComments((cData.items as Comment[] | null) ?? []);
      setActivities((aData.items as Activity[] | null) ?? []);
    } catch { /* ignore */ }
    finally { setActivityLoading(false); }
  }, [id]);

  useEffect(() => {
    if (tab === "activity" && !activityLoaded.current) {
      activityLoaded.current = true;
      void loadActivity();
    }
  }, [tab, loadActivity]);

  async function handleStatus(status: TaskStatus) {
    if (!task) return;
    setSaving(true);
    try {
      const updated = await updateTask(task.id, { status, version: task.version });
      setTask(updated);
      // invalidate activity cache so next visit re-loads
      activityLoaded.current = false;
    } finally { setSaving(false); }
  }

  async function handlePriority(priority: TaskPriority) {
    if (!task) return;
    setSaving(true);
    try {
      const updated = await updateTask(task.id, { priority, version: task.version });
      setTask(updated);
      activityLoaded.current = false;
    } finally { setSaving(false); }
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !commentBody.trim()) return;
    setSubmitting(true);
    setCommentError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: commentBody.trim(), authorId: user?.id ?? "" }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setCommentBody("");
      await loadActivity();
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  }

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!task)   return <div className="p-8 text-danger">Task not found.</div>;

  const TABS: { id: Tab; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "activity", label: `Activity${comments.length > 0 ? ` (${comments.length})` : ""}` },
  ];

  return (
    <div className="flex h-full flex-col overflow-auto">
      {/* Header */}
      <div className="border-b border-line bg-linear-to-r from-surface-2 via-paper to-paper px-6 py-4">
        <button onClick={() => router.back()} className="mb-2 text-[11px] text-ink-3 hover:text-accent">
          ← Back
        </button>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusColors[task.status]}`}>
                {task.status.replace("_", " ")}
              </span>
              <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${priorityColors[task.priority]}`}>
                {task.priority}
              </span>
              <span className="rounded bg-surface-2 px-2 py-0.5 text-xs capitalize text-ink-3">
                {task.type}
              </span>
              {task.code && (
                <span className="font-mono text-xs text-ink-3">{task.code}</span>
              )}
            </div>
            <h1 className="mt-1 text-xl font-semibold text-ink">{task.title}</h1>
          </div>
          <div className="shrink-0 pt-1">
            <RunWorkflowButton
              context={{
                task_id: task.id,
                task_title: task.title,
                project_id: task.projectId,
              }}
            />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line px-6">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ${
              tab === t.id
                ? "border-accent text-accent"
                : "border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {tab === "details" && (
          <div className="space-y-4 max-w-3xl">
            {task.description && (
              <div className="rounded-md border border-line bg-paper p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">Description</p>
                <p className="whitespace-pre-wrap text-sm text-ink-2">{task.description}</p>
              </div>
            )}

            {/* Status transitions */}
            <div className="rounded-md border border-line bg-paper p-4">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-ink-3">Move to Status</p>
              <div className="flex flex-wrap gap-2">
                {STATUSES.filter((s) => s !== task.status).map((s) => (
                  <button
                    type="button"
                    key={s}
                    onClick={() => handleStatus(s)}
                    disabled={saving}
                    className="rounded border border-line px-3 py-1 text-xs capitalize hover:bg-surface-2 disabled:opacity-50"
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            {/* Priority selector */}
            <div className="rounded-md border border-line bg-paper p-4">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-ink-3">Priority</p>
              <div className="flex flex-wrap gap-2">
                {(["low", "med", "high", "critical"] as TaskPriority[]).filter((p) => p !== task.priority).map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => handlePriority(p)}
                    disabled={saving}
                    className={`rounded border px-3 py-1 text-xs capitalize disabled:opacity-50 ${priorityColors[p]} hover:bg-surface-2`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "Project",  value: task.projectId?.slice(-8) ?? "—" },
                { label: "Assignee", value: task.assigneeId ? task.assigneeId.slice(-8) : "—" },
                { label: "Due Date", value: task.dueDate ? String(task.dueDate).slice(0, 10) : "—" },
                { label: "Estimate", value: task.estimateMd != null ? `${task.estimateMd} md` : "—" },
                { label: "Actual",   value: task.actualMd != null ? `${task.actualMd} md` : "—" },
                { label: "Progress", value: task.progressPct != null ? `${task.progressPct}%` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-md border border-line bg-surface px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-widest text-ink-3">{label}</p>
                  <p className="mt-0.5 font-mono text-sm text-ink">{value}</p>
                </div>
              ))}
            </div>

            {task.tags && task.tags.length > 0 && (
              <div className="rounded-md border border-line bg-paper p-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {task.tags.map((tag) => (
                    <span key={tag} className="rounded bg-accent/10 px-2 py-0.5 text-xs text-accent">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[11px] text-ink-3">
              <p>Created: {task.createdAt ? task.createdAt.slice(0, 10) : "—"}</p>
              <p>Updated: {task.updatedAt ? task.updatedAt.slice(0, 10) : "—"}</p>
            </div>
          </div>
        )}

        {tab === "activity" && (
          <div className="max-w-2xl space-y-6">
            {/* Comment form */}
            <form onSubmit={handleComment} className="rounded-md border border-line bg-paper p-4">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">Add Comment</p>
              <textarea
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                placeholder="Write a comment..."
                rows={3}
                className="w-full resize-none rounded border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
              {commentError && (
                <p className="mt-1 text-[11px] text-danger">{commentError}</p>
              )}
              <div className="mt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || !commentBody.trim()}
                  className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? "Posting..." : "Post Comment"}
                </button>
              </div>
            </form>

            {/* Activity + comments timeline */}
            {activityLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-md border border-line bg-surface-2" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {/* Comments */}
                {comments.length > 0 && (
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">Comments</p>
                    <div className="divide-y divide-line rounded-md border border-line bg-paper">
                      {comments.map((c) => (
                        <div key={c.id} className="flex gap-3 px-4 py-3">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] text-accent">
                            {c.authorId.slice(-2).toUpperCase()}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[10px] text-ink-3">{c.authorId.slice(-8)}</span>
                              <span className="text-[10px] text-ink-3">{relTime(c.createdAt)}</span>
                            </div>
                            <p className="mt-0.5 text-sm text-ink">{c.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Activity log */}
                {activities.length > 0 && (
                  <div>
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-3">Activity Log</p>
                    <div className="space-y-0 rounded-md border border-line bg-paper">
                      {activities.map((a) => (
                        <div key={a.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
                          <span className="shrink-0">{activityIcon(a.kind)}</span>
                          <span className="flex-1 text-xs text-ink-2">{activityLabel(a)}</span>
                          <span className="shrink-0 font-mono text-[10px] text-ink-3">{relTime(a.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {comments.length === 0 && activities.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <MessageCircle size={28} className="text-ink-3/40" />
                    <p className="text-sm text-ink-2">No activity yet</p>
                    <p className="text-[11px] text-ink-3">Be the first to comment on this task</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
