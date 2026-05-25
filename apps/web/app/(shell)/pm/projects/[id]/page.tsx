"use client";

import { use, useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, X, ArrowLeft } from "lucide-react";
import { Button, Input, Tag, TextArea } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { ProcessFlowBar } from "@/shell/ProcessFlowBar";
import {
  getProject,
  updateProject,
  deleteProject,
  type Project,
} from "@/lib/api/projects";
import { ProjectTasksTab } from "@/components/ProjectTasksTab";
import { GanttChart } from "@/components/GanttChart";
import { TaskSheet } from "@/components/TaskSheet";
import { listTasksForProject, type Task } from "@/lib/api/tasks";
import { listSprintsForProject, type Sprint } from "@/lib/api/sprints";
import { listAudit, type AuditEvent } from "@/lib/api/audit";
import { UserPicker } from "@/components/UserPicker";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  description: string;
  status: Project["status"];
  startDate: string;
  dueDate: string;
  ownerId: string;
  progressPct: number;
  tags: string[];
}

function toFormState(p: Project): FormState {
  return {
    name: p.name,
    description: p.description,
    status: p.status,
    startDate: p.startDate?.slice(0, 10) ?? "",
    dueDate: p.dueDate?.slice(0, 10) ?? "",
    ownerId: p.ownerId ?? "",
    progressPct: p.progressPct,
    tags: p.tags ?? [],
  };
}

function isDirty(a: FormState, b: FormState): boolean {
  return (
    a.name !== b.name ||
    a.description !== b.description ||
    a.status !== b.status ||
    a.startDate !== b.startDate ||
    a.dueDate !== b.dueDate ||
    a.ownerId !== b.ownerId ||
    a.progressPct !== b.progressPct ||
    JSON.stringify(a.tags) !== JSON.stringify(b.tags)
  );
}

// ─── Stages for ProcessFlowBar ────────────────────────────────────────────────

const STAGES = [
  { id: "planning", label: "Planning" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
];

function statusTone(s: Project["status"]): "success" | "warning" | "neutral" | "signal" {
  switch (s) {
    case "active": return "success";
    case "on_hold": return "warning";
    case "completed": return "neutral";
    case "cancelled": return "signal";
    default: return "neutral";
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type TabId = "overview" | "tasks" | "gantt" | "sprints" | "activity";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Tasks" },
  { id: "gantt", label: "Gantt" },
  { id: "sprints", label: "Sprints" },
  { id: "activity", label: "Activity" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<TabId>("overview");

  // Form state
  const [form, setForm] = useState<FormState | null>(null);
  const baseline = useRef<FormState | null>(null);

  // Save / error state
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState(false);

  // Delete dialog
  const [showDelete, setShowDelete] = useState(false);

  // Tag input buffer
  const [tagInput, setTagInput] = useState("");

  // Gantt state
  const [ganttTasks, setGanttTasks] = useState<Task[]>([]);
  const [ganttLoading, setGanttLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const fetchProject = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    setConflictError(false);
    try {
      const p = await getProject(id);
      setProject(p);
      const fs = toFormState(p);
      setForm(fs);
      baseline.current = fs;
      setNotFound(false);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("404") || msg.includes("get failed: 404")) {
        setNotFound(true);
      } else {
        setSaveError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchProject();
  }, [fetchProject]);

  useEffect(() => {
    if (tab !== "gantt" || !id) return;
    setGanttLoading(true);
    listTasksForProject(id, { limit: 200 })
      .then(({ items }) => setGanttTasks(items))
      .catch(() => {})
      .finally(() => setGanttLoading(false));
  }, [tab, id]);

  const dirty = form && baseline.current ? isDirty(form, baseline.current) : false;

  function patchForm(patch: Partial<FormState>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setSaveError(null);
    setConflictError(false);
  }

  async function handleSave(thenClose = false) {
    if (!project || !form || !dirty) return;
    setSaving(true);
    setSaveError(null);
    setConflictError(false);
    try {
      const updated = await updateProject(id, {
        name: form.name,
        description: form.description,
        status: form.status,
        owner_id: form.ownerId || null,
        progress_pct: form.progressPct,
        start_date: form.startDate || null,
        due_date: form.dueDate || null,
        tags: form.tags,
        version: project.version,
      });
      setProject(updated);
      const fs = toFormState(updated);
      setForm(fs);
      baseline.current = fs;
      if (thenClose) router.push("/pm/projects");
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

  function commitTagInput() {
    if (!tagInput.trim()) return;
    const newTags = tagInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    patchForm({ tags: [...(form?.tags ?? []), ...newTags].filter((v, i, a) => a.indexOf(v) === i) });
    setTagInput("");
  }

  // ── Loading skeleton ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <Breadcrumb
          items={[
            { label: "Home", href: "/pm/home" },
            { label: "Projects", href: "/pm/projects" },
            { label: "…" },
          ]}
        />
        <div className="flex-1 animate-pulse space-y-3 p-6">
          <div className="h-8 w-48 rounded-sm bg-surface-2" />
          <div className="h-4 w-72 rounded-sm bg-surface-2" />
          <div className="mt-6 h-32 rounded-md bg-surface-2" />
        </div>
      </div>
    );
  }

  // ── Not found ───────────────────────────────────────────────────────────────

  if (notFound) {
    return (
      <div className="flex h-full flex-col">
        <Breadcrumb
          items={[
            { label: "Home", href: "/pm/home" },
            { label: "Projects", href: "/pm/projects" },
            { label: id },
          ]}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-lg font-semibold text-ink">Project not found</p>
          <p className="text-sm text-ink-3">
            No project with id <span className="font-mono">{id}</span> exists.
          </p>
          <Button
            variant="secondary"
            onClick={() => router.push("/pm/projects")}
          >
            <ArrowLeft size={14} />
            Back to Projects
          </Button>
        </div>
      </div>
    );
  }

  if (!project || !form) return null;

  // ── Stage for flow bar: map on_hold/cancelled to nearest stage ──────────────
  const flowStage =
    project.status === "on_hold" || project.status === "cancelled"
      ? "active"
      : project.status;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[
          { label: "Home", href: "/pm/home" },
          { label: "Projects", href: "/pm/projects" },
          { label: project.code },
        ]}
      />

      <CommandBar
        actions={[
          {
            id: "save",
            label: "Save",
            variant: "primary",
            icon: <Save size={14} />,
            onClick: () => handleSave(false),
            disabled: !dirty || saving,
          },
          {
            id: "saveclose",
            label: "Save & Close",
            variant: "secondary",
            onClick: () => handleSave(true),
            disabled: !dirty || saving,
          },
          { kind: "separator", id: "s1" },
          {
            id: "del",
            label: "Delete",
            variant: "ghost",
            icon: <Trash2 size={14} className="text-danger" />,
            onClick: () => setShowDelete(true),
          },
        ]}
      />

      {/* Error banners */}
      {saveError && (
        <div className="border-b border-danger/30 bg-danger/5 px-4 py-2 text-[12px] text-danger">
          {saveError}
        </div>
      )}
      {conflictError && (
        <div className="flex items-center gap-3 border-b border-warning/30 bg-warning/5 px-4 py-2 text-[12px] text-ink-2">
          <span className="font-medium text-warning">Conflict:</span>
          Someone else modified this project. Refresh to see the latest version.
          <Button
            variant="ghost"
            size="sm"
            onClick={fetchProject}
          >
            Refresh
          </Button>
        </div>
      )}

      {/* Header card */}
      <div className="border-b border-line bg-paper px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">
              {project.code}
            </span>
            <h1 className="mt-0.5 truncate text-xl font-semibold text-ink">
              {project.name}
            </h1>
          </div>
          <div className="shrink-0 pt-1">
            <Tag tone={statusTone(project.status)} dot>
              {project.status.replace("_", " ")}
            </Tag>
          </div>
        </div>
        <div className="mt-3">
          <ProcessFlowBar stages={STAGES} current={flowStage} />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-line bg-paper px-4">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors ${
              tab === t.id
                ? "border-accent text-ink"
                : "border-transparent text-ink-3 hover:text-ink-2"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tab === "overview" && (
          <OverviewTab
            form={form}
            patchForm={patchForm}
            tagInput={tagInput}
            setTagInput={setTagInput}
            commitTagInput={commitTagInput}
          />
        )}
        {tab === "tasks" && <ProjectTasksTab projectId={id} />}
        {tab === "gantt" && (
          <div className="p-0">
            {ganttLoading ? (
              <div className="flex items-center justify-center h-48 text-sm text-ink-3">Loading…</div>
            ) : (
              <GanttChart
                tasks={ganttTasks}
                onTaskClick={(t) => setSelectedTaskId(t.id)}
              />
            )}
            {selectedTaskId && (
              <TaskSheet
                taskId={selectedTaskId}
                onClose={() => setSelectedTaskId(null)}
                onChanged={() => {
                  setSelectedTaskId(null);
                  listTasksForProject(id, { limit: 200 }).then(({ items }) => setGanttTasks(items)).catch(() => {});
                }}
              />
            )}
          </div>
        )}
        {tab === "sprints" && <ProjectSprintsTab projectId={id} />}
        {tab === "activity" && <ProjectActivityTab projectId={id} />}
      </div>

      {showDelete && (
        <DeleteDialog
          project={project}
          onClose={() => setShowDelete(false)}
          onDeleted={() => router.push("/pm/projects")}
        />
      )}
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({
  form,
  patchForm,
  tagInput,
  setTagInput,
  commitTagInput,
}: {
  form: FormState;
  patchForm: (p: Partial<FormState>) => void;
  tagInput: string;
  setTagInput: (v: string) => void;
  commitTagInput: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Basics card */}
        <SectionCard title="Basics">
          <Field label="Name" required>
            <Input
              value={form.name}
              onChange={(e) => patchForm({ name: e.target.value })}
              placeholder="Project name"
            />
          </Field>
          <Field label="Description">
            <TextArea
              value={form.description}
              onChange={(e) => patchForm({ description: e.target.value })}
              placeholder="What is this project about?"
              rows={4}
            />
          </Field>
          <Field label="Status">
            <StatusSelect
              value={form.status}
              onChange={(v) => patchForm({ status: v })}
            />
          </Field>
        </SectionCard>

        {/* Schedule card */}
        <SectionCard title="Schedule">
          <Field label="Start Date">
            <Input
              type="date"
              value={form.startDate}
              onChange={(e) => patchForm({ startDate: e.target.value })}
            />
          </Field>
          <Field label="Due Date">
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => patchForm({ dueDate: e.target.value })}
            />
          </Field>
          <Field label="Progress (0–100)">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={form.progressPct}
                onChange={(e) => patchForm({ progressPct: Number(e.target.value) })}
                className="progress-range flex-1"
                aria-label="Progress percentage"
              />
              <span className="w-10 text-right font-mono text-sm tabular-nums text-ink">
                {form.progressPct}%
              </span>
            </div>
          </Field>
          <Field label="Owner">
            <UserPicker
              value={form.ownerId ?? ""}
              onChange={(id) => patchForm({ ownerId: id })}
              placeholder="Search team members…"
            />
          </Field>
        </SectionCard>
      </div>

      {/* Tags card — full width */}
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
                  aria-label={`Remove tag ${tag}`}
                  onClick={() =>
                    patchForm({ tags: form.tags.filter((t) => t !== tag) })
                  }
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
          onBlur={commitTagInput}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitTagInput();
            }
          }}
          placeholder="Type tags separated by commas, press Enter to add"
        />
        <p className="mt-1 text-[11px] text-ink-3">
          Separate multiple tags with commas.
        </p>
      </SectionCard>
    </div>
  );
}

function sprintStatusTone(status: Sprint["status"]): "neutral" | "success" | "warning" {
  if (status === "active") return "success";
  if (status === "closed") return "neutral";
  return "warning";
}

function ProjectSprintsTab({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listSprintsForProject(projectId)
      .then((sprints) => {
        if (!cancelled) setItems(sprints);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  const active = items.filter((s) => s.status === "active").length;
  const totalCapacity = items.reduce((sum, s) => sum + (s.capacityPts ?? 0), 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <MiniKpi label="Sprints" value={String(items.length)} />
        <MiniKpi label="Active" value={String(active)} />
        <MiniKpi label="Capacity" value={totalCapacity > 0 ? `${totalCapacity} pts` : "—"} />
      </div>

      {error && (
        <div className="rounded-sm border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
      )}

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-sm bg-surface-2" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-6 py-8 text-center text-sm text-ink-3">
          No sprints yet for this project. Create one from <a href="/pm/sprints" className="text-accent underline">Sprint Board</a>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                <th className="px-3 py-2">Sprint</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Window</th>
                <th className="px-3 py-2">Capacity</th>
              </tr>
            </thead>
            <tbody>
              {items.map((sp, i) => (
                <tr key={sp.id} className={`border-b border-line last:border-0 ${i % 2 === 0 ? "bg-paper" : "bg-surface"}`}>
                  <td className="px-3 py-2">
                    <a className="font-medium text-ink hover:underline" href={`/pm/sprints/${sp.id}`}>{sp.name}</a>
                    {sp.goal && <div className="text-xs text-ink-3">{sp.goal}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <Tag tone={sprintStatusTone(sp.status)} dot>{sp.status}</Tag>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-2">
                    {sp.startDate ? sp.startDate.slice(0, 10) : "—"} → {sp.endDate ? sp.endDate.slice(0, 10) : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-2">{sp.capacityPts > 0 ? `${sp.capacityPts} pts` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProjectActivityTab({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listAudit({ entityId: projectId, limit: 25, offset: 0 })
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [projectId]);

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-sm border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</div>
      )}

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 rounded-sm bg-surface-2" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-line px-6 py-8 text-center text-sm text-ink-3">
          No audit activity found for this project yet. View full stream at <a href="/pm/audit" className="text-accent underline">Audit Explorer</a>.
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Service</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">User</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ev, i) => (
                <tr key={ev.id} className={`border-b border-line last:border-0 ${i % 2 === 0 ? "bg-paper" : "bg-surface"}`}>
                  <td className="px-3 py-2 font-mono text-xs text-ink-2">{ev.ts ? ev.ts.slice(0, 19).replace("T", " ") : "—"}</td>
                  <td className="px-3 py-2 text-xs text-ink-2">{ev.service || "—"}</td>
                  <td className="px-3 py-2 text-xs text-ink">{ev.action || "—"}</td>
                  <td className="px-3 py-2">
                    <Tag tone={ev.result === "deny" || ev.result === "error" ? "danger" : "success"}>{ev.result || "ok"}</Tag>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-3">{ev.userId ? `${ev.userId.slice(0, 8)}…` : "system"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-line bg-paper px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{label}</div>
      <div className="mt-1 font-mono text-sm text-ink">{value}</div>
    </div>
  );
}

// ─── Delete dialog ────────────────────────────────────────────────────────────

function DeleteDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: Project;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await deleteProject(project.id, project.version);
      onDeleted();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-label="Delete project"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md border border-line bg-surface p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold text-ink">Delete project</h2>
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            This permanently removes{" "}
            <span className="font-mono font-semibold text-ink">{project.code}</span>{" "}
            — {project.name}. This action cannot be undone.
          </p>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
              Type <span className="font-mono text-ink">{project.code}</span> to confirm
            </span>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="font-mono"
              placeholder={project.code}
              autoFocus
            />
          </label>
          {err && (
            <div className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
              {err}
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={confirm !== project.code || busy}
              loading={busy}
              onClick={submit}
            >
              Delete project
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared form atoms ────────────────────────────────────────────────────────

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-line bg-surface p-4 shadow-xs">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
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

function StatusSelect({
  value,
  onChange,
}: {
  value: Project["status"];
  onChange: (v: Project["status"]) => void;
}) {
  const options: Array<{ value: Project["status"]; label: string }> = [
    { value: "planning", label: "Planning" },
    { value: "active", label: "Active" },
    { value: "on_hold", label: "On Hold" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
  ];
  return (
    <select
      aria-label="Status"
      value={value}
      onChange={(e) => onChange(e.target.value as Project["status"])}
      className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
