"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Timer, ChevronRight, Calendar } from "lucide-react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { listProjects, type Project } from "@/lib/api/projects";
import {
  listSprintsForProject,
  createSprint,
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
  projects: Project[];
  onClose: () => void;
  onCreated: (sprintId: string) => void;
}

function CreateSprintDialog({ projects, onClose, onCreated }: CreateDialogProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [capacityPts, setCapacityPts] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-md bg-paper shadow-pop border border-line p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-ink mb-4">New Sprint</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="create-sprint-project" className="text-xs font-medium text-ink-2 mb-1 block">Project *</label>
            <select
              id="create-sprint-project"
              aria-label="Project"
              className="w-full rounded-xs border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
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
            <label className="text-xs font-medium text-ink-2 mb-1 block">Sprint name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 1" required />
          </div>
          <div>
            <label className="text-xs font-medium text-ink-2 mb-1 block">Goal</label>
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should we achieve?" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="create-sprint-start" className="text-xs font-medium text-ink-2 mb-1 block">Start date</label>
              <input id="create-sprint-start" aria-label="Start date" type="date" className="w-full rounded-xs border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="create-sprint-end" className="text-xs font-medium text-ink-2 mb-1 block">End date</label>
              <input id="create-sprint-end" aria-label="End date" type="date" className="w-full rounded-xs border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-ink-2 mb-1 block">Capacity (story points)</label>
            <Input type="number" value={capacityPts} onChange={(e) => setCapacityPts(e.target.value)} placeholder="40" min="0" />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={loading}>
              {loading ? "Creating…" : "Create Sprint"}
            </Button>
          </div>
        </form>
      </div>
    </div>
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

  useEffect(() => {
    loadProjects().then(() => {});
  }, [loadProjects]);

  useEffect(() => {
    loadSprints(selectedProjectId, projects).then(() => {});
  }, [selectedProjectId, projects, loadSprints]);

  function handleCreated(sprintId: string) {
    setShowCreate(false);
    router.push(`/pm/sprints/${sprintId}`);
  }

  const projectById = Object.fromEntries(projects.map((p) => [p.id, p]));

  const commandActions = [
    {
      id: "new-sprint",
      label: "New Sprint",
      icon: <Plus size={14} />,
      variant: "primary" as const,
      onClick: () => setShowCreate(true),
      disabled: projects.length === 0,
    },
    { kind: "separator" as const, id: "sep1" },
    {
      id: "refresh",
      label: "Refresh",
      icon: <RefreshCw size={14} />,
      onClick: () => loadSprints(selectedProjectId, projects),
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Sprints" }]} />
      <CommandBar actions={commandActions} />

      {/* Filters */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-line bg-paper">
        <span className="text-xs text-ink-3 font-medium">Project:</span>
        <select
          aria-label="Filter by project"
          className="rounded-xs border border-line bg-surface px-2 py-1 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
        >
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {error && (
          <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-40 text-ink-3 text-sm">Loading sprints…</div>
        ) : sprints.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-60 gap-3">
            <Timer size={40} className="text-ink-3 opacity-40" />
            <p className="text-ink-3 text-sm font-medium">No sprints yet</p>
            {projects.length === 0 ? (
              <p className="text-ink-3 text-xs">Create a project first, then plan your sprints.</p>
            ) : (
              <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                <Plus size={14} /> Create Sprint
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-md border border-line overflow-hidden bg-paper">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-xs text-ink-3">
                  <th className="px-3 py-2 text-left font-medium">Sprint</th>
                  <th className="px-3 py-2 text-left font-medium">Project</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Dates</th>
                  <th className="px-3 py-2 text-right font-medium">Capacity</th>
                  <th className="px-3 py-2 text-right font-medium">Created</th>
                  <th className="w-6" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {sprints.map((sp, i) => {
                  const proj = projectById[sp.projectId];
                  return (
                    <tr
                      key={sp.id}
                      className={`border-b border-line hover:bg-surface cursor-pointer transition-colors ${i % 2 === 0 ? "" : "bg-surface-2/30"}`}
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
                          <span className="font-mono text-xs text-ink-2 bg-surface-2 px-1.5 py-0.5 rounded-xs">{proj.code}</span>
                        ) : (
                          <span className="text-xs text-ink-3">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Tag tone={STATUS_TONE[sp.status]}>{STATUS_LABEL[sp.status]}</Tag>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1 text-xs text-ink-2">
                          <Calendar size={11} className="opacity-50" />
                          {fmtDate(sp.startDate)} → {fmtDate(sp.endDate)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-ink-2">
                        {sp.capacityPts > 0 ? `${sp.capacityPts} pts` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-ink-3">
                        {fmtDate(sp.createdAt)}
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

      {showCreate && (
        <CreateSprintDialog
          projects={projects}
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
