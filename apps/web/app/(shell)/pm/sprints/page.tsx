"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, ChevronRight, Calendar, Trash2 } from "lucide-react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog, EmptyState, LoadingState } from "@pmplatform/ui-kit";
import { listProjects, type Project } from "@/lib/api/projects";
import {
  listSprintsForProject,
  createSprint,
  deleteSprint,
  type Sprint,
  type SprintStatus,
} from "@/lib/api/sprints";

// ── Status helpers ─────────────────────────────────────────────────────────

const STATUS_TONE: Record<SprintStatus, "info" | "success" | "neutral"> = {
  planning: "info",
  active: "success",
  closed: "neutral",
};
const STATUS_LABEL: Record<SprintStatus, string> = {
  planning: "Planning",
  active: "Active",
  closed: "Closed",
};

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ── Create Sprint Dialog ───────────────────────────────────────────────────

interface CreateDialogProps {
  open: boolean;
  projects: Project[];
  onClose: () => void;
  onCreated: (sprintId: string) => void;
}

function CreateSprintDialog({ open, projects, onClose, onCreated }: CreateDialogProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [capacityPts, setCapacityPts] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open && projects.length > 0 && !projectId) setProjectId(projects[0].id);
  }, [open, projects, projectId]);

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    if (!projectId) { setError("Select a project"); return; }
    setLoading(true);
    setError("");
    try {
      const sp = await createSprint(projectId, {
        name: name.trim(),
        goal: goal.trim() || undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        capacity_pts: capacityPts ? Number(capacityPts) : undefined,
      });
      onCreated(sp.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create sprint");
    } finally {
      setLoading(false);
    }
  }

  const lbl = "mb-1 block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3";
  const fld = "h-9 w-full appearance-none rounded-sm border border-line bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New sprint"
      description="Plan a time-boxed iteration with capacity and goal"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void handleSubmit()}>Create Sprint</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label htmlFor="create-sprint-project" className={lbl}>Project *</label>
          <select
            id="create-sprint-project"
            aria-label="Project"
            className={fld}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <span className={lbl}>Sprint name *</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 1" required data-autofocus />
        </div>
        <div>
          <span className={lbl}>Goal</span>
          <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should we achieve?" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="create-sprint-start" className={lbl}>Start date</label>
            <input id="create-sprint-start" aria-label="Start date" type="date" className={fld} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="create-sprint-end" className={lbl}>End date</label>
            <input id="create-sprint-end" aria-label="End date" type="date" className={fld} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div>
          <span className={lbl}>Capacity (story points)</span>
          <Input type="number" value={capacityPts} onChange={(e) => setCapacityPts(e.target.value)} placeholder="40" min="0" />
        </div>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </form>
    </Dialog>
  );
}

// ── Delete Sprint Dialog ───────────────────────────────────────────────────

function DeleteSprintDialog({
  sprint,
  onClose,
  onDeleted,
}: {
  sprint: Sprint;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);

  async function handleDelete() {
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      await deleteSprint(sprint.id, sprint.version);
      onDeleted();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to delete sprint";
      if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
        setConflict(true);
      } else {
        setError(msg);
      }
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Delete sprint"
      description="This soft-deletes the sprint. Tasks remain but lose this sprint assignment."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={() => void handleDelete()}>Delete sprint</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-2">
          Delete <span className="font-medium text-ink">{sprint.name}</span>? This action cannot be undone from here.
        </p>
        {conflict && (
          <p role="alert" className="rounded-sm border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-ink-2">
            <span className="font-medium text-warning">Conflict:</span> this sprint changed elsewhere. Refresh the list and retry.
          </p>
        )}
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function SprintsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Sprint | null>(null);
  const [error, setError] = useState("");

  const loadProjects = useCallback(async () => {
    try {
      const { items } = await listProjects({ limit: 100 });
      setProjects(items);
    } catch {
      setError("Failed to load projects");
    }
  }, []);

  const loadSprints = useCallback(async (projId: string, projs: Project[]) => {
    setLoading(true);
    setError("");
    try {
      if (projId === "all") {
        const all = await Promise.all(projs.map((p) => listSprintsForProject(p.id)));
        const flat = all.flat().sort((a, b) => {
          const aDate = a.startDate ?? a.createdAt;
          const bDate = b.startDate ?? b.createdAt;
          return bDate.localeCompare(aDate);
        });
        setSprints(flat);
      } else {
        const items = await listSprintsForProject(projId);
        setSprints(items);
      }
    } catch {
      setError("Failed to load sprints");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProjects().then(() => {}); }, [loadProjects]);
  useEffect(() => { loadSprints(selectedProjectId, projects).then(() => {}); }, [selectedProjectId, projects, loadSprints]);

  function handleCreated(sprintId: string) {
    setShowCreate(false);
    router.push(`/pm/sprints/${sprintId}`);
  }

  const projectById = Object.fromEntries(projects.map((p) => [p.id, p]));

  // ── KPI strip ────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const byStatus = { planning: 0, active: 0, closed: 0 };
    let capacity = 0;
    for (const s of sprints) {
      byStatus[s.status]++;
      capacity += s.capacityPts ?? 0;
    }
    return { byStatus, capacity };
  }, [sprints]);

  const commandActions = [
    { id: "new-sprint", label: "New Sprint", icon: <Plus size={14} />, variant: "primary" as const, onClick: () => setShowCreate(true), disabled: projects.length === 0 },
    { kind: "separator" as const, id: "sep1" },
    { id: "refresh", label: "Refresh", icon: <RefreshCw size={14} />, onClick: () => loadSprints(selectedProjectId, projects) },
  ];

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Sprints" }]} />
      <CommandBar actions={commandActions} />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
          {/* Editorial header */}
          <header className="reveal-up flex items-end justify-between gap-6 border-b border-line pb-5">
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
                ◢ control room · sprints
              </div>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">Sprints</h1>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">scope</div>
              <div className="font-mono text-[11px] tabular-nums text-ink-2">
                {selectedProjectId === "all" ? "all projects" : projectById[selectedProjectId]?.code ?? "—"}
              </div>
            </div>
          </header>

          {/* KPI strip */}
          <section className="reveal-up relative overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs" aria-label="Sprint KPIs">
            <div aria-hidden className="pointer-events-none absolute inset-0 blueprint-grid" />
            <div className="relative grid grid-cols-2 sm:grid-cols-5 divide-y divide-line sm:divide-y-0 sm:divide-x">
              {[
                { label: "total",    value: sprints.length,         tone: "accent" as const },
                { label: "planning", value: kpis.byStatus.planning, tone: "accent" as const },
                { label: "active",   value: kpis.byStatus.active,   tone: "accent" as const },
                { label: "closed",   value: kpis.byStatus.closed,   tone: "accent" as const },
                { label: "capacity",  value: kpis.capacity > 0 ? `${kpis.capacity}pts` : "—", tone: "accent" as const },
              ].map((k) => (
                <div key={k.label} className="flex flex-col gap-1 px-4 py-4">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${(k.tone as string) === "signal" ? "bg-signal" : "bg-accent"}`} />
                    {k.label}
                  </div>
                  <div className="font-mono text-[22px] font-semibold leading-none tabular-nums text-ink">{k.value}</div>
                </div>
              ))}
            </div>
          </section>

          {/* Project filter */}
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">Project</span>
            <select
              aria-label="Filter by project"
              className="h-8 rounded-sm border border-line-strong bg-surface px-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              <option value="all">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          {loading ? (
            <LoadingState rows={4} ariaLabel="Loading sprints" />
          ) : sprints.length === 0 ? (
            <EmptyState
              code="◇ no sprints"
              title={projects.length === 0 ? "Create a project first." : "No sprints yet."}
              description={projects.length === 0 ? "Sprints live inside projects — create a project before planning iterations." : "Plan a time-boxed iteration with a goal and capacity."}
              action={projects.length > 0 ? <Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={13} className="mr-1" />Create Sprint</Button> : undefined}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <th className="px-3 py-2.5">Sprint</th>
                    <th className="px-3 py-2.5">Project</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Dates</th>
                    <th className="px-3 py-2.5 text-right">Capacity</th>
                    <th className="px-3 py-2.5 text-right">Created</th>
                    <th className="w-8" aria-label="Delete" />
                    <th className="w-6" aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {sprints.map((sp) => {
                    const proj = projectById[sp.projectId];
                    return (
                      <tr
                        key={sp.id}
                        className="border-b border-line/60 last:border-0 hover:bg-paper cursor-pointer transition-colors"
                        onClick={() => router.push(`/pm/sprints/${sp.id}`)}
                      >
                        <td className="px-3 py-2.5">
                          <span className="font-medium text-ink">{sp.name}</span>
                          {sp.goal && (
                            <span className="ml-2 text-xs text-ink-3 truncate max-w-xs">{sp.goal}</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {proj ? (
                            <span className="font-mono text-[11px] text-ink-2 bg-paper border border-line-strong px-1.5 py-0.5 rounded-xs">{proj.code}</span>
                          ) : (
                            <span className="text-xs text-ink-3">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <Tag tone={STATUS_TONE[sp.status]}>{STATUS_LABEL[sp.status]}</Tag>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-ink-2">
                            <Calendar size={11} className="opacity-50" />
                            {fmtDate(sp.startDate)} → {fmtDate(sp.endDate)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[11px] tabular-nums text-ink-2">
                          {sp.capacityPts > 0 ? `${sp.capacityPts}pts` : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[11px] tabular-nums text-ink-3">
                          {fmtDate(sp.createdAt)}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            aria-label={`Delete ${sp.name}`}
                            onClick={(e) => { e.stopPropagation(); setDeleteTarget(sp); }}
                            className="rounded-sm p-1 text-ink-3 hover:bg-danger/10 hover:text-danger"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <ChevronRight size={14} className="text-ink-3 opacity-50" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <CreateSprintDialog
        open={showCreate}
        projects={projects}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
      />

      {deleteTarget && (
        <DeleteSprintDialog
          sprint={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            void loadSprints(selectedProjectId, projects);
          }}
        />
      )}
    </div>
  );
}
