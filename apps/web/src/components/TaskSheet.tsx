"use client";

import { useEffect, useRef, useState } from "react";
import { X, Trash2, Plus } from "lucide-react";
import { Button, Input, Tag, TextArea } from "@pmplatform/ui-kit";
import {
  getTask,
  updateTask,
  deleteTask,
  addDependency,
  removeDependency,
  type Task,
  type TaskType,
  type TaskStatus,
  type TaskPriority,
  type DepType,
  type Dependency,
} from "@/lib/api/tasks";
import { statusTone, priorityTone, statusLabel, priorityLabel } from "@/lib/api/taskTones";
import { UserPicker } from "@/components/UserPicker";

// ─── Types ────────────────────────────────────────────────────────────────────

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

function isDirty(a: FormState, b: FormState): boolean {
  return (
    a.title !== b.title ||
    a.description !== b.description ||
    a.type !== b.type ||
    a.status !== b.status ||
    a.priority !== b.priority ||
    a.assigneeId !== b.assigneeId ||
    a.reviewerId !== b.reviewerId ||
    a.startDate !== b.startDate ||
    a.dueDate !== b.dueDate ||
    a.estimateMd !== b.estimateMd ||
    a.actualMd !== b.actualMd ||
    a.progressPct !== b.progressPct ||
    JSON.stringify(a.tags) !== JSON.stringify(b.tags)
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  taskId: string | null;
  onClose(): void;
  onChanged(): void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskSheet({ taskId, onClose, onChanged }: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const baseline = useRef<FormState | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState(false);

  const [showDelete, setShowDelete] = useState(false);
  const [tagInput, setTagInput] = useState("");

  // Dependencies
  const [deps, setDeps] = useState<Dependency[]>([]);
  const [depPredId, setDepPredId] = useState("");
  const [depType, setDepType] = useState<DepType>("fs");
  const [depLag, setDepLag] = useState("0");
  const [depError, setDepError] = useState<string | null>(null);
  const [depAdding, setDepAdding] = useState(false);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      setForm(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setConflictError(false);
    setDeps([]);
    getTask(taskId)
      .then((t) => {
        if (cancelled) return;
        setTask(t);
        const fs = toForm(t);
        setForm(fs);
        baseline.current = fs;
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [taskId]);

  if (!taskId) return null;

  const open = !!taskId;
  const dirty = form && baseline.current ? isDirty(form, baseline.current) : false;

  function patch(p: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...p } : prev));
    setSaveError(null);
    setConflictError(false);
  }

  function commitTag() {
    if (!tagInput.trim()) return;
    const newTags = tagInput.split(",").map((t) => t.trim()).filter(Boolean);
    patch({ tags: [...(form?.tags ?? []), ...newTags].filter((v, i, a) => a.indexOf(v) === i) });
    setTagInput("");
  }

  async function handleSave(thenClose = false) {
    if (!task || !form || !dirty) return;
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
      const fs = toForm(updated);
      setForm(fs);
      baseline.current = fs;
      onChanged();
      if (thenClose) onClose();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
        setConflictError(true);
      } else {
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDep() {
    if (!task || !depPredId.trim()) return;
    setDepAdding(true);
    setDepError(null);
    try {
      const dep = await addDependency(task.id, {
        predecessor_id: depPredId.trim(),
        type: depType,
        lag_days: parseInt(depLag) || 0,
      });
      setDeps((d) => [...d, dep]);
      setDepPredId("");
      setDepLag("0");
    } catch (e) {
      setDepError((e as Error).message);
    } finally {
      setDepAdding(false);
    }
  }

  async function handleRemoveDep(depId: string) {
    try {
      await removeDependency(depId);
      setDeps((d) => d.filter((x) => x.id !== depId));
    } catch {
      // ignore
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm transition-opacity duration-200 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-label="Task detail"
        className={`fixed right-0 top-0 z-50 flex h-full w-[480px] max-w-full flex-col border-l border-line bg-surface shadow-pop transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Sheet header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {loading ? (
              <div className="h-5 w-32 animate-pulse rounded-sm bg-surface-2" />
            ) : task ? (
              <>
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">{task.code}</span>
                <h2 className="mt-0.5 text-base font-semibold text-ink leading-tight">{task.title}</h2>
              </>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-0.5">
            {task && (
              <Tag tone={statusTone(task.status)} dot>
                {statusLabel(task.status)}
              </Tag>
            )}
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="rounded-sm p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Sheet body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="space-y-3 animate-pulse">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 rounded-md bg-surface-2" />
              ))}
            </div>
          )}

          {loadError && (
            <div className="rounded-sm border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
              {loadError}
            </div>
          )}

          {!loading && !loadError && form && task && (
            <div className="space-y-4">
              {/* Error banners */}
              {saveError && (
                <div className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
                  {saveError}
                </div>
              )}
              {conflictError && (
                <div className="rounded-sm border border-warning/40 bg-warning/10 p-2 text-xs text-ink-2">
                  <span className="font-medium text-warning">Conflict:</span> Someone else modified this task.{" "}
                  <button
                    type="button"
                    className="underline hover:text-ink"
                    onClick={() => { setConflictError(false); /* re-fetch */ getTask(task.id).then((t) => { setTask(t); const fs = toForm(t); setForm(fs); baseline.current = fs; }); }}
                  >
                    Reload
                  </button>
                </div>
              )}

              {/* Basics */}
              <SectionCard title="Basics">
                <Field label="Title" required>
                  <Input value={form.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Task title" />
                </Field>
                <Field label="Description">
                  <TextArea value={form.description} onChange={(e) => patch({ description: e.target.value })} placeholder="Describe the task…" rows={3} />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Type">
                    <select
                      aria-label="Type"
                      value={form.type}
                      onChange={(e) => patch({ type: e.target.value as TaskType })}
                      className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                    >
                      {(["task","subtask","milestone","deliverable","issue","risk","bug"] as TaskType[]).map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Status">
                    <select
                      aria-label="Status"
                      value={form.status}
                      onChange={(e) => patch({ status: e.target.value as TaskStatus })}
                      className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                    >
                      {(["todo","in_progress","blocked","review","done","cancelled"] as TaskStatus[]).map((v) => (
                        <option key={v} value={v}>{statusLabel(v)}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Priority">
                    <select
                      aria-label="Priority"
                      value={form.priority}
                      onChange={(e) => patch({ priority: e.target.value as TaskPriority })}
                      className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                    >
                      {(["low","med","high","critical"] as TaskPriority[]).map((v) => (
                        <option key={v} value={v}>{priorityLabel(v)}</option>
                      ))}
                    </select>
                  </Field>
                </div>
              </SectionCard>

              {/* Assignment */}
              <SectionCard title="Assignment">
                <Field label="Assignee">
                  <UserPicker
                    value={form.assigneeId}
                    onChange={(id) => patch({ assigneeId: id })}
                    placeholder="Search assignee…"
                  />
                </Field>
                <Field label="Reviewer">
                  <UserPicker
                    value={form.reviewerId}
                    onChange={(id) => patch({ reviewerId: id })}
                    placeholder="Search reviewer…"
                  />
                </Field>
              </SectionCard>

              {/* Schedule */}
              <SectionCard title="Schedule">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Start Date">
                    <Input type="date" value={form.startDate} onChange={(e) => patch({ startDate: e.target.value })} />
                  </Field>
                  <Field label="Due Date">
                    <Input type="date" value={form.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} />
                  </Field>
                  <Field label="Estimate (md)">
                    <Input type="number" step="0.5" min="0" value={form.estimateMd} onChange={(e) => patch({ estimateMd: e.target.value })} className="font-mono" />
                  </Field>
                  <Field label="Actual (md)">
                    <Input type="number" step="0.5" min="0" value={form.actualMd} onChange={(e) => patch({ actualMd: e.target.value })} className="font-mono" />
                  </Field>
                </div>
                <Field label={`Progress: ${form.progressPct}%`}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={form.progressPct}
                    onChange={(e) => patch({ progressPct: Number(e.target.value) })}
                    className="progress-range w-full"
                    aria-label="Progress percentage"
                  />
                </Field>
              </SectionCard>

              {/* Tags */}
              <SectionCard title="Tags">
                {form.tags.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {form.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-xs border border-line bg-surface-2 px-2 py-0.5 text-[12px] text-ink-2"
                      >
                        {tag}
                        <button
                          type="button"
                          aria-label={`Remove ${tag}`}
                          onClick={() => patch({ tags: form.tags.filter((t) => t !== tag) })}
                          className="text-ink-3 hover:text-danger"
                        >
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
              </SectionCard>

              {/* Dependencies */}
              <SectionCard title="Dependencies">
                {deps.length > 0 && (
                  <div className="mb-3 space-y-1.5">
                    {deps.map((dep) => (
                      <div key={dep.id} className="flex items-center justify-between rounded-xs bg-surface-2 px-3 py-1.5 text-xs text-ink-2">
                        <span>
                          <span className="font-mono text-ink-3">{dep.predecessorId.slice(0, 8)}…</span>
                          {" → "}
                          <Tag tone="neutral">{dep.type}</Tag>
                          {dep.lagDays > 0 && <span className="ml-1 text-ink-3">+{dep.lagDays}d</span>}
                        </span>
                        <button
                          type="button"
                          aria-label="Remove dependency"
                          onClick={() => void handleRemoveDep(dep.id)}
                          className="text-ink-3 hover:text-danger"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-[11px] text-ink-3">Add predecessor (enter task UUID)</p>
                  <div className="flex gap-2">
                    <Input
                      value={depPredId}
                      onChange={(e) => setDepPredId(e.target.value)}
                      placeholder="Predecessor task UUID"
                      className="flex-1 font-mono text-[12px]"
                    />
                    <select
                      aria-label="Dependency type"
                      value={depType}
                      onChange={(e) => setDepType(e.target.value as DepType)}
                      className="h-9 appearance-none rounded-sm border border-line bg-surface px-2 text-sm text-ink focus:outline-none"
                    >
                      {(["fs","ss","ff","sf"] as DepType[]).map((v) => (
                        <option key={v} value={v}>{v.toUpperCase()}</option>
                      ))}
                    </select>
                    <Input
                      type="number"
                      min="0"
                      value={depLag}
                      onChange={(e) => setDepLag(e.target.value)}
                      placeholder="lag"
                      className="w-16 font-mono text-[12px]"
                    />
                  </div>
                  {depError && <p className="text-xs text-danger">{depError}</p>}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleAddDep()}
                    disabled={!depPredId.trim() || depAdding}
                    loading={depAdding}
                  >
                    <Plus size={13} />
                    Add dependency
                  </Button>
                </div>
              </SectionCard>
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && !loadError && task && form && (
          <div className="shrink-0 border-t border-line bg-paper px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowDelete(true)}
              >
                <Trash2 size={13} />
                Delete
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!dirty || saving}
                  loading={saving}
                  onClick={() => void handleSave(true)}
                >
                  Save &amp; Close
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!dirty || saving}
                  loading={saving}
                  onClick={() => void handleSave(false)}
                >
                  Save
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirm dialog */}
      {showDelete && task && (
        <DeleteTaskDialog
          task={task}
          onClose={() => setShowDelete(false)}
          onDeleted={() => { setShowDelete(false); onChanged(); onClose(); }}
        />
      )}
    </>
  );
}

// ─── Delete dialog ────────────────────────────────────────────────────────────

function DeleteTaskDialog({ task, onClose, onDeleted }: { task: Task; onClose(): void; onDeleted(): void }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await deleteTask(task.id, task.version);
      onDeleted();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Delete task"
      className="fixed inset-0 z-[60] grid place-items-center bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md border border-line bg-surface p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold text-ink">Delete task</h2>
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            This permanently removes{" "}
            <span className="font-mono font-semibold text-ink">{task.code}</span>{" "}
            — {task.title}. This action cannot be undone.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
              Type <span className="font-mono text-ink">{task.code}</span> to confirm
            </span>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="font-mono"
              placeholder={task.code}
              autoFocus
            />
          </label>
          {err && (
            <div className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              type="button"
              variant="danger"
              disabled={confirm !== task.code || busy}
              loading={busy}
              onClick={() => void submit()}
            >
              Delete task
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-xs">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{title}</div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {label}
        {required && <span className="ml-0.5 text-signal">*</span>}
      </span>
      {children}
    </label>
  );
}
