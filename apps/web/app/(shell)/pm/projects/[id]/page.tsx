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

type TabId = "overview" | "tasks" | "sprints" | "activity";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "tasks", label: "Tasks" },
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
        {tab === "sprints" && <PlaceholderTab message="Sprints UI ships with Page #4" />}
        {tab === "activity" && (
          <PlaceholderTab message="Activity will surface from audit pipeline (Phase 2)" />
        )}
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
          <Field label="Owner ID">
            <Input
              value={form.ownerId}
              onChange={(e) => patchForm({ ownerId: e.target.value })}
              placeholder="UUID of owner (identity lookup in Phase 2)"
              className="font-mono text-[12px]"
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

// ─── Placeholder tab ──────────────────────────────────────────────────────────

function PlaceholderTab({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <div className="rounded-md border border-dashed border-line px-8 py-6 text-sm text-ink-3">
        {message}
      </div>
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
