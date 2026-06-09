"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, Clock, MessageCircle, Pencil, TrendingUp, Trash2, Check, X } from "lucide-react";
import { Button, Input, TextArea } from "@pmplatform/ui-kit";
import {
  getTask,
  updateTask,
  listComments,
  createComment,
  updateComment,
  deleteComment,
  type Task,
  type TaskStatus,
  type TaskPriority,
  type TaskType,
  type TaskComment,
} from "@/lib/api/tasks";
import { useAuth } from "@/lib/auth/AuthProvider";
import { RunWorkflowButton } from "@/components/RunWorkflowButton";
import { WorklogPanel } from "@/components/WorklogPanel";
import { UserPicker } from "@/components/UserPicker";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Activity {
  id: string;
  actorId?: string;
  kind: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}

interface FormState {
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  reviewerId: string;
  startDate: string;
  dueDate: string;
  estimateMd: string;
  actualMd: string;
  progressPct: number;
  tags: string[];
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
const TYPES: TaskType[] = ["task", "subtask", "milestone", "deliverable", "issue", "risk", "bug"];
const PRIORITIES: TaskPriority[] = ["low", "med", "high", "critical"];

function toForm(t: Task): FormState {
  return {
    title: t.title,
    description: t.description,
    type: t.type,
    status: t.status,
    priority: t.priority,
    assigneeId: t.assigneeId ?? "",
    reviewerId: t.reviewerId ?? "",
    startDate: t.startDate?.slice(0, 10) ?? "",
    dueDate: t.dueDate?.slice(0, 10) ?? "",
    estimateMd: String(t.estimateMd),
    actualMd: String(t.actualMd),
    progressPct: t.progressPct,
    tags: t.tags ?? [],
  };
}

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

type Tab = "details" | "time" | "activity";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState(false);
  const [tab, setTab] = useState<Tab>("details");

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [tagInput, setTagInput] = useState("");

  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const activityLoaded = useRef(false);

  const reload = useCallback(async () => {
    if (!id) return;
    const t = await getTask(id);
    setTask(t);
    setForm(toForm(t));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    getTask(id)
      .then((t) => { setTask(t); setForm(toForm(t)); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const loadActivity = useCallback(async () => {
    if (!id) return;
    setActivityLoading(true);
    try {
      const [cmts, aRes] = await Promise.all([
        listComments(id),
        fetch(`/api/tasks/${id}/activity`).then((r) => r.json()),
      ]);
      setComments(cmts);
      setActivities((aRes.items as Activity[] | null) ?? []);
    } catch { /* ignore */ }
    finally { setActivityLoading(false); }
  }, [id]);

  useEffect(() => {
    if (tab === "activity" && !activityLoaded.current) {
      activityLoaded.current = true;
      void loadActivity();
    }
  }, [tab, loadActivity]);

  function patch(p: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...p } : prev));
    setSaveError(null);
    setConflictError(false);
  }

  function commitTag() {
    if (!tagInput.trim() || !form) return;
    const newTags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
    patch({ tags: [...form.tags, ...newTags].filter((v, i, a) => a.indexOf(v) === i) });
    setTagInput("");
  }

  async function handleQuickPatch(p: { status?: TaskStatus; priority?: TaskPriority }) {
    if (!task) return;
    setSaving(true);
    setSaveError(null);
    setConflictError(false);
    try {
      const updated = await updateTask(task.id, { ...p, version: task.version });
      setTask(updated);
      setForm(toForm(updated));
      activityLoaded.current = false;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("409") || msg.toLowerCase().includes("conflict")) setConflictError(true);
      else setSaveError(msg);
    } finally { setSaving(false); }
  }

  async function handleSaveEdit() {
    if (!task || !form) return;
    setSaving(true);
    setSaveError(null);
    setConflictError(false);
    try {
      const updated = await updateTask(task.id, {
        title: form.title,
        description: form.description,
        type: form.type,
        status: form.status,
        priority: form.priority,
        assignee_id: form.assigneeId || null,
        reviewer_id: form.reviewerId || null,
        start_date: form.startDate || null,
        due_date: form.dueDate || null,
        estimate_md: parseFloat(form.estimateMd) || 0,
        actual_md: parseFloat(form.actualMd) || 0,
        progress_pct: form.progressPct,
        tags: form.tags,
        version: task.version,
      });
      setTask(updated);
      setForm(toForm(updated));
      setEditing(false);
      activityLoaded.current = false;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("409") || msg.toLowerCase().includes("conflict")) setConflictError(true);
      else setSaveError(msg);
    } finally { setSaving(false); }
  }

  async function handleComment(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !commentBody.trim()) return;
    setSubmitting(true);
    setCommentError(null);
    try {
      await createComment(task.id, user?.id ?? "", commentBody.trim());
      setCommentBody("");
      await loadActivity();
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : String(err));
    } finally { setSubmitting(false); }
  }

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!task || !form) return <div className="p-8 text-danger">Task not found.</div>;

  const TABS: { id: Tab; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "time", label: "Time" },
    { id: "activity", label: `Activity${comments.length > 0 ? ` (${comments.length})` : ""}` },
  ];

  const fld = "h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15";
  const lbl = "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3";

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
          <div className="flex shrink-0 items-center gap-2 pt-1">
            {!editing && (
              <Button size="sm" variant="secondary" onClick={() => { setEditing(true); setForm(toForm(task)); }}>
                <Pencil size={13} /> Edit
              </Button>
            )}
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

      {/* Conflict / error banners */}
      {saveError && (
        <div className="border-b border-danger/30 bg-danger/5 px-6 py-2 text-[12px] text-danger">{saveError}</div>
      )}
      {conflictError && (
        <div className="flex items-center gap-3 border-b border-warning/30 bg-warning/5 px-6 py-2 text-[12px] text-ink-2">
          <span className="font-medium text-warning">Conflict:</span>
          Someone else modified this task. Reload to see the latest version.
          <Button variant="ghost" size="sm" onClick={() => { setConflictError(false); void reload(); }}>Reload</Button>
        </div>
      )}

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
        {tab === "details" && !editing && (
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
                    onClick={() => handleQuickPatch({ status: s })}
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
                {PRIORITIES.filter((p) => p !== task.priority).map((p) => (
                  <button
                    type="button"
                    key={p}
                    onClick={() => handleQuickPatch({ priority: p })}
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
                { label: "Reviewer", value: task.reviewerId ? task.reviewerId.slice(-8) : "—" },
                { label: "Start Date", value: task.startDate ? String(task.startDate).slice(0, 10) : "—" },
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

        {tab === "details" && editing && (
          <div className="max-w-3xl space-y-4">
            <div className="rounded-md border border-line bg-paper p-4 space-y-3">
              <div>
                <span className={lbl}>Title</span>
                <Input value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Task title" />
              </div>
              <div>
                <span className={lbl}>Description</span>
                <TextArea value={form.description} onChange={(e) => patch({ description: e.target.value })} rows={4} placeholder="Describe the task…" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="edit-type" className={lbl}>Type</label>
                  <select id="edit-type" aria-label="Type" className={fld} value={form.type} onChange={(e) => patch({ type: e.target.value as TaskType })}>
                    {TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-status" className={lbl}>Status</label>
                  <select id="edit-status" aria-label="Status" className={fld} value={form.status} onChange={(e) => patch({ status: e.target.value as TaskStatus })}>
                    {STATUSES.map((v) => <option key={v} value={v}>{v.replace("_", " ")}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-priority" className={lbl}>Priority</label>
                  <select id="edit-priority" aria-label="Priority" className={fld} value={form.priority} onChange={(e) => patch({ priority: e.target.value as TaskPriority })}>
                    {PRIORITIES.map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="rounded-md border border-line bg-paper p-4 space-y-3">
              <div>
                <span className={lbl}>Assignee</span>
                <UserPicker value={form.assigneeId} onChange={(uid) => patch({ assigneeId: uid })} placeholder="Search assignee…" />
              </div>
              <div>
                <span className={lbl}>Reviewer</span>
                <UserPicker value={form.reviewerId} onChange={(uid) => patch({ reviewerId: uid })} placeholder="Search reviewer…" />
              </div>
            </div>

            <div className="rounded-md border border-line bg-paper p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="edit-start" className={lbl}>Start Date</label>
                  <input id="edit-start" type="date" className={fld} value={form.startDate} onChange={(e) => patch({ startDate: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="edit-due" className={lbl}>Due Date</label>
                  <input id="edit-due" type="date" className={fld} value={form.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} />
                </div>
                <div>
                  <span className={lbl}>Estimate (md)</span>
                  <Input type="number" step="0.5" min="0" value={form.estimateMd} onChange={(e) => patch({ estimateMd: e.target.value })} className="font-mono" />
                </div>
                <div>
                  <span className={lbl}>Actual (md)</span>
                  <Input type="number" step="0.5" min="0" value={form.actualMd} onChange={(e) => patch({ actualMd: e.target.value })} className="font-mono" />
                </div>
              </div>
              <div>
                <span className={lbl}>Progress: {form.progressPct}%</span>
                <input type="range" min={0} max={100} value={form.progressPct} onChange={(e) => patch({ progressPct: Number(e.target.value) })} className="progress-range w-full" aria-label="Progress percentage" />
              </div>
            </div>

            <div className="rounded-md border border-line bg-paper p-4 space-y-2">
              <span className={lbl}>Tags</span>
              {form.tags.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {form.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-xs border border-line bg-surface-2 px-2 py-0.5 text-[12px] text-ink-2">
                      {tag}
                      <button type="button" aria-label={`Remove ${tag}`} onClick={() => patch({ tags: form.tags.filter((t) => t !== tag) })} className="text-ink-3 hover:text-danger">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onBlur={commitTag}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitTag(); } }}
                placeholder="Add tags (comma-separated)"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => { setEditing(false); setForm(toForm(task)); setSaveError(null); setConflictError(false); }}>Cancel</Button>
              <Button variant="primary" loading={saving} disabled={saving || !form.title.trim()} onClick={() => void handleSaveEdit()}>Save changes</Button>
            </div>
          </div>
        )}

        {tab === "time" && (
          <div className="max-w-2xl">
            <WorklogPanel taskId={task.id} estimateMd={task.estimateMd} actualMd={task.actualMd} />
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
                        <CommentRow
                          key={c.id}
                          comment={c}
                          canManage={!!user?.id && c.authorId === user.id}
                          onChanged={loadActivity}
                        />
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

// ─── Comment row (inline edit + delete) ────────────────────────────────────────

function CommentRow({ comment, canManage, onChanged }: { comment: TaskComment; canManage: boolean; onChanged(): Promise<void> | void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  async function save() {
    if (!draft.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await updateComment(comment.id, draft.trim(), comment.version);
      setEditing(false);
      await onChanged();
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg.includes("409") || msg.toLowerCase().includes("conflict")
        ? "This comment changed elsewhere — refresh and retry."
        : msg);
    } finally { setBusy(false); }
  }

  async function del() {
    setBusy(true);
    setErr(null);
    try {
      await deleteComment(comment.id, comment.version);
      await onChanged();
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg.includes("409") || msg.toLowerCase().includes("conflict")
        ? "This comment changed elsewhere — refresh and retry."
        : msg);
      setBusy(false);
      setConfirmDel(false);
    }
  }

  return (
    <div className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[10px] text-accent">
        {comment.authorId.slice(-2).toUpperCase()}
      </span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-ink-3">{comment.authorId.slice(-8)}</span>
          <span className="text-[10px] text-ink-3">{relTime(comment.createdAt)}</span>
          {comment.updatedAt && comment.updatedAt !== comment.createdAt && (
            <span className="text-[10px] italic text-ink-3">edited</span>
          )}
          {canManage && !editing && (
            <span className="ml-auto flex items-center gap-1">
              <button type="button" aria-label="Edit comment" onClick={() => { setEditing(true); setDraft(comment.body); setErr(null); }} className="rounded-sm p-1 text-ink-3 hover:bg-surface-2 hover:text-ink">
                <Pencil size={12} />
              </button>
              {confirmDel ? (
                <>
                  <button type="button" disabled={busy} onClick={() => void del()} className="rounded-sm px-1.5 py-0.5 text-[11px] font-semibold text-danger hover:bg-danger/10 disabled:opacity-40">Delete</button>
                  <button type="button" onClick={() => setConfirmDel(false)} className="rounded-sm px-1.5 py-0.5 text-[11px] text-ink-3 hover:bg-surface-2">Cancel</button>
                </>
              ) : (
                <button type="button" aria-label="Delete comment" onClick={() => setConfirmDel(true)} className="rounded-sm p-1 text-ink-3 hover:bg-danger/10 hover:text-danger">
                  <Trash2 size={12} />
                </button>
              )}
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1 space-y-2">
            <TextArea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} />
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy || !draft.trim()} onClick={() => void save()} className="inline-flex items-center gap-1 rounded bg-accent px-2 py-1 text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50">
                <Check size={12} /> Save
              </button>
              <button type="button" onClick={() => { setEditing(false); setErr(null); }} className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-ink-3 hover:bg-surface-2">
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-sm text-ink">{comment.body}</p>
        )}
        {err && <p className="mt-1 text-[11px] text-danger">{err}</p>}
      </div>
    </div>
  );
}
