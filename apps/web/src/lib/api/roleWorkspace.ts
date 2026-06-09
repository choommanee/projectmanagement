// Role-workspace data client (BA / SA / Expert).
//
// This module is self-contained: it composes EXISTING read endpoints
// (project-svc /v1/tasks + /v1/projects via /api/tasks, /api/projects, and
// document-svc /v1/documents via /api/documents) into the per-role surfaces the
// BA / SA / Expert workspaces render. It deliberately does NOT import from
// tasks.ts / projects.ts / documents.ts so it stays decoupled from concurrent
// edits to those clients — every shape is normalised here from the canonical
// snake_case backend payloads (with PascalCase fallbacks for defence).

export type RoleKind = "ba" | "sa" | "expert";

// ─── Normalised entities (subset of fields the workspaces render) ───────────────

export interface RoleTask {
  id: string;
  projectId: string;
  code: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  assigneeId: string | null;
  reviewerId: string | null;
  progressPct: number;
  dueDate: string | null;
  tags: string[];
  updatedAt: string;
}

export interface RoleProject {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  progressPct: number;
  updatedAt: string;
}

export interface RoleDoc {
  id: string;
  projectId: string;
  type: string;
  title: string;
  status: string;
  tags: string[];
  updatedAt: string;
}

// Read either snake_case (canonical) or PascalCase (legacy) keys.
function pick(r: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = r[k];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function normTask(r: Record<string, unknown>): RoleTask {
  return {
    id: String(pick(r, "id", "ID") ?? ""),
    projectId: String(pick(r, "project_id", "ProjectID") ?? ""),
    code: String(pick(r, "code", "Code") ?? ""),
    title: String(pick(r, "title", "Title") ?? ""),
    type: String(pick(r, "type", "Type") ?? "task"),
    status: String(pick(r, "status", "Status") ?? "todo"),
    priority: String(pick(r, "priority", "Priority") ?? "med"),
    assigneeId: (pick(r, "assignee_id", "AssigneeID") as string | undefined) ?? null,
    reviewerId: (pick(r, "reviewer_id", "ReviewerID") as string | undefined) ?? null,
    progressPct: Number(pick(r, "progress_pct", "ProgressPct") ?? 0),
    dueDate: (pick(r, "due_date", "DueDate") as string | undefined) ?? null,
    tags: (pick(r, "tags", "Tags") as string[] | undefined) ?? [],
    updatedAt: String(pick(r, "updated_at", "UpdatedAt") ?? ""),
  };
}

function normProject(r: Record<string, unknown>): RoleProject {
  return {
    id: String(pick(r, "id", "ID") ?? ""),
    code: String(pick(r, "code", "Code") ?? ""),
    name: String(pick(r, "name", "Name") ?? ""),
    description: String(pick(r, "description", "Description") ?? ""),
    status: String(pick(r, "status", "Status") ?? "planning"),
    progressPct: Number(pick(r, "progress_pct", "ProgressPct") ?? 0),
    updatedAt: String(pick(r, "updated_at", "UpdatedAt") ?? ""),
  };
}

function normDoc(r: Record<string, unknown>): RoleDoc {
  return {
    id: String(pick(r, "id", "ID") ?? ""),
    projectId: String(pick(r, "project_id", "ProjectID") ?? ""),
    type: String(pick(r, "type", "Type") ?? "note"),
    title: String(pick(r, "title", "Title") ?? ""),
    status: String(pick(r, "status", "Status") ?? "draft"),
    tags: (pick(r, "tags", "Tags") as string[] | undefined) ?? [],
    updatedAt: String(pick(r, "updated_at", "UpdatedAt") ?? ""),
  };
}

function arrOf(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body as Record<string, unknown>[];
  const b = body as { items?: unknown } | null;
  return (b?.items as Record<string, unknown>[] | null) ?? [];
}

// ─── Low-level fetchers (each maps every field FE↔API) ──────────────────────────

export interface TaskQuery {
  tag?: string[]; // overlap: tasks holding ANY of these tags
  type?: string;
  reviewer?: string;
  assignee?: string;
  status?: string;
  limit?: number;
}

export async function listRoleTasks(
  q: TaskQuery = {},
): Promise<{ items: RoleTask[]; total: number }> {
  const qs = new URLSearchParams();
  if (q.tag?.length) qs.set("tag", q.tag.join(","));
  if (q.type) qs.set("type", q.type);
  if (q.reviewer) qs.set("reviewer", q.reviewer);
  if (q.assignee) qs.set("assignee", q.assignee);
  if (q.status) qs.set("status", q.status);
  qs.set("limit", String(q.limit ?? 100));
  const r = await fetch(`/api/tasks?${qs}`);
  if (!r.ok) throw new Error(`role tasks failed: ${r.status}`);
  const body = await r.json();
  const items = arrOf(body).map(normTask);
  const total = Number((body as { total?: number }).total ?? items.length);
  return { items, total };
}

export async function listRoleProjects(
  params: { status?: string; limit?: number } = {},
): Promise<{ items: RoleProject[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  qs.set("limit", String(params.limit ?? 100));
  const r = await fetch(`/api/projects?${qs}`);
  if (!r.ok) throw new Error(`role projects failed: ${r.status}`);
  const body = await r.json();
  const items = arrOf(body).map(normProject);
  const total = Number((body as { total?: number }).total ?? items.length);
  return { items, total };
}

export async function listRoleDocs(
  params: { limit?: number } = {},
): Promise<{ items: RoleDoc[]; total: number }> {
  const qs = new URLSearchParams();
  qs.set("limit", String(params.limit ?? 200));
  const r = await fetch(`/api/documents?${qs}`);
  if (!r.ok) throw new Error(`role docs failed: ${r.status}`);
  const body = await r.json();
  const items = arrOf(body).map(normDoc);
  const total = Number((body as { total?: number }).total ?? items.length);
  return { items, total };
}

// ─── Role configuration ─────────────────────────────────────────────────────────

const OPEN_STATUSES = new Set(["todo", "in_progress", "blocked", "review"]);

export function isOpen(status: string): boolean {
  return OPEN_STATUSES.has(status);
}

export interface RoleConfig {
  kind: RoleKind;
  /** Tags used to surface role-relevant tasks (array-overlap match). */
  taskTags: string[];
  /** Document types this role owns/consumes (in display priority order). */
  docTypes: string[];
  /** Task type spotlighted for this role (risk / issue), if any. */
  spotlightType?: string;
  /** Whether the spotlight is "tasks awaiting my review" (reviewer = me). */
  spotlightReviewer?: boolean;
  /** Project statuses surfaced for this role. */
  projectStatuses: string[];
}

export const ROLE_CONFIG: Record<RoleKind, RoleConfig> = {
  ba: {
    kind: "ba",
    taskTags: ["ba", "analysis", "requirements", "discovery", "backlog"],
    docTypes: [
      "project_charter",
      "status_report",
      "risk_register",
      "brd",
      "frd",
      "user_story",
      "use_case",
      "process_flow",
      "rtm",
    ],
    spotlightType: "risk",
    projectStatuses: ["planning"], // discovery
  },
  sa: {
    kind: "sa",
    taskTags: ["architecture", "go", "infra", "auth", "security", "api", "backend", "design", "ci"],
    docTypes: [
      "sdd",
      "adr",
      "er_diagram",
      "api_spec",
      "sequence_diagram",
      "tech_stack",
      "project_charter",
    ],
    spotlightType: "issue",
    projectStatuses: ["active", "planning"],
  },
  expert: {
    kind: "expert",
    taskTags: ["review", "knowledge", "expertise", "lesson"],
    docTypes: ["expertise_profile", "lesson_learned", "knowledge_article", "decision_log", "qa"],
    spotlightReviewer: true,
    projectStatuses: ["active", "planning"],
  },
};

// ─── Aggregated workspace payload ───────────────────────────────────────────────

export interface RoleWorkspaceData {
  /** Open, role-tagged tasks (capped, newest first). */
  roleTasks: RoleTask[];
  /** Total count of role-tagged tasks (all statuses) reported by backend. */
  roleTasksTotal: number;
  /** Spotlight tasks: open risks/issues (BA/SA) or items awaiting my review (Expert). */
  spotlightTasks: RoleTask[];
  /** Role-relevant documents, newest first. */
  docs: RoleDoc[];
  /** Documents still draft/review (need attention). */
  docsInProgress: number;
  /** Projects in the role's relevant statuses. */
  projects: RoleProject[];
  kpis: {
    openTasks: number; // open role-tagged tasks
    spotlight: number; // open risks/issues or review requests
    docs: number; // role-relevant documents
    projects: number; // projects in role statuses
  };
}

function sortByUpdated<T extends { updatedAt: string }>(a: T, b: T): number {
  return (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");
}

/**
 * loadRoleWorkspace composes the live read endpoints into the per-role surface.
 * `reviewerId` is required for the Expert spotlight (tasks awaiting my review).
 */
export async function loadRoleWorkspace(
  kind: RoleKind,
  reviewerId?: string,
): Promise<RoleWorkspaceData> {
  const cfg = ROLE_CONFIG[kind];

  const spotlightPromise = cfg.spotlightReviewer
    ? reviewerId
      ? listRoleTasks({ reviewer: reviewerId, limit: 100 })
      : Promise.resolve({ items: [], total: 0 })
    : cfg.spotlightType
      ? listRoleTasks({ type: cfg.spotlightType, limit: 100 })
      : Promise.resolve({ items: [], total: 0 });

  const [tasksRes, spotlightRes, docsRes, ...projRes] = await Promise.all([
    listRoleTasks({ tag: cfg.taskTags, limit: 100 }),
    spotlightPromise,
    listRoleDocs({ limit: 200 }),
    ...cfg.projectStatuses.map((s) => listRoleProjects({ status: s, limit: 100 })),
  ]);

  const openRoleTasks = tasksRes.items.filter((t) => isOpen(t.status)).sort(sortByUpdated);
  const openSpotlight = spotlightRes.items.filter((t) => isOpen(t.status)).sort(sortByUpdated);

  const typeSet = new Set(cfg.docTypes);
  const docs = docsRes.items.filter((d) => typeSet.has(d.type)).sort(sortByUpdated);
  const docsInProgress = docs.filter((d) => d.status === "draft" || d.status === "review").length;

  const projById = new Map<string, RoleProject>();
  for (const p of projRes.flatMap((r) => r.items)) projById.set(p.id, p);
  const projects = [...projById.values()].sort(sortByUpdated);

  return {
    roleTasks: openRoleTasks.slice(0, 8),
    roleTasksTotal: tasksRes.total,
    spotlightTasks: openSpotlight.slice(0, 6),
    docs: docs.slice(0, 8),
    docsInProgress,
    projects: projects.slice(0, 6),
    kpis: {
      openTasks: openRoleTasks.length,
      spotlight: openSpotlight.length,
      docs: docs.length,
      projects: projects.length,
    },
  };
}
