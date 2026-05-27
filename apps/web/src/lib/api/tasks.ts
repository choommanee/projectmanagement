export type TaskType     = "task" | "subtask" | "milestone" | "deliverable" | "issue" | "risk" | "bug";
export type TaskStatus   = "todo" | "in_progress" | "blocked" | "review" | "done" | "cancelled";
export type TaskPriority = "low" | "med" | "high" | "critical";
export type DepType      = "fs" | "ss" | "ff" | "sf";

export interface Task {
  id: string;
  tenantId: string;
  projectId: string;
  parentId?: string | null;
  code: string;
  title: string;
  description: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string | null;
  reviewerId?: string | null;
  estimateMd: number;
  actualMd: number;
  progressPct: number;
  startDate?: string | null;
  dueDate?: string | null;
  sortOrder: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface Dependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DepType;
  lagDays: number;
}

function get(raw: Record<string, unknown>, k: string) {
  return raw[k] ?? raw[k[0].toUpperCase() + k.slice(1)];
}

export function normTask(raw: Record<string, unknown>): Task {
  return {
    id:           String(get(raw, "id") ?? raw["ID"] ?? ""),
    tenantId:     String(get(raw, "tenantId") ?? raw["TenantID"] ?? raw["tenant_id"] ?? ""),
    projectId:    String(get(raw, "projectId") ?? raw["ProjectID"] ?? raw["project_id"] ?? ""),
    parentId:     (get(raw, "parentId") ?? raw["ParentID"] ?? raw["parent_id"]) as string | null | undefined,
    code:         String(get(raw, "code")),
    title:        String(get(raw, "title")),
    description:  String(get(raw, "description") ?? ""),
    type:         (get(raw, "type") ?? "task") as TaskType,
    status:       (get(raw, "status") ?? "todo") as TaskStatus,
    priority:     (get(raw, "priority") ?? "med") as TaskPriority,
    assigneeId:   (get(raw, "assigneeId") ?? raw["AssigneeID"] ?? raw["assignee_id"]) as string | null | undefined,
    reviewerId:   (get(raw, "reviewerId") ?? raw["ReviewerID"] ?? raw["reviewer_id"]) as string | null | undefined,
    estimateMd:   Number(get(raw, "estimateMd") ?? raw["EstimateMd"] ?? raw["estimate_md"] ?? 0),
    actualMd:     Number(get(raw, "actualMd")   ?? raw["ActualMd"]   ?? raw["actual_md"]   ?? 0),
    progressPct:  Number(get(raw, "progressPct") ?? raw["ProgressPct"] ?? raw["progress_pct"] ?? 0),
    startDate:    (get(raw, "startDate") ?? raw["StartDate"] ?? raw["start_date"]) as string | null | undefined,
    dueDate:      (get(raw, "dueDate")   ?? raw["DueDate"]   ?? raw["due_date"])   as string | null | undefined,
    sortOrder:    Number(get(raw, "sortOrder") ?? raw["SortOrder"] ?? raw["sort_order"] ?? 0),
    tags:         (get(raw, "tags") ?? []) as string[],
    createdAt:    String(get(raw, "createdAt") ?? raw["CreatedAt"] ?? ""),
    updatedAt:    String(get(raw, "updatedAt") ?? raw["UpdatedAt"] ?? ""),
    version:      Number(get(raw, "version") ?? 1),
  };
}

export interface ListTasksParams { projectId?: string; status?: TaskStatus; q?: string; assignee?: string; limit?: number; offset?: number; }

export async function listTasksForProject(projectId: string, params: Omit<ListTasksParams, "projectId"> = {}): Promise<{ items: Task[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  if (params.assignee) qs.set("assignee", params.assignee);
  qs.set("limit", String(params.limit ?? 100));
  qs.set("offset", String(params.offset ?? 0));
  const r = await fetch(`/api/projects/${projectId}/tasks?${qs}`);
  if (!r.ok) throw new Error(`list failed: ${r.status}`);
  const body = await r.json();
  return { items: (body.items as Record<string, unknown>[] | null ?? []).map(normTask), total: body.total ?? 0 };
}

export async function listAllTasks(params: Omit<ListTasksParams, "projectId"> = {}): Promise<{ items: Task[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  if (params.assignee) qs.set("assignee", params.assignee);
  qs.set("limit", String(params.limit ?? 200));
  qs.set("offset", String(params.offset ?? 0));
  const r = await fetch(`/api/tasks?${qs}`);
  if (!r.ok) throw new Error(`list failed: ${r.status}`);
  const body = await r.json();
  return { items: (body.items as Record<string, unknown>[] | null ?? []).map(normTask), total: body.total ?? 0 };
}

export async function getTask(id: string): Promise<Task> {
  const r = await fetch(`/api/tasks/${id}`);
  if (!r.ok) throw new Error(`get failed: ${r.status}`);
  return normTask(await r.json());
}

export interface CreateTaskInput {
  code: string;
  title: string;
  description?: string;
  type?: TaskType;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_id?: string | null;
  estimate_md?: number;
  parent_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  tags?: string[];
}

export async function createTask(projectId: string, input: CreateTaskInput): Promise<Task> {
  const r = await fetch(`/api/projects/${projectId}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `create failed: ${r.status}`);
  }
  return normTask(await r.json());
}

export interface UpdateTaskPatch {
  title?: string;
  description?: string;
  type?: TaskType;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_id?: string | null;
  reviewer_id?: string | null;
  estimate_md?: number;
  actual_md?: number;
  progress_pct?: number;
  start_date?: string | null;
  due_date?: string | null;
  sort_order?: number;
  tags?: string[];
  parent_id?: string | null;
  version: number;
}

export async function updateTask(id: string, patch: UpdateTaskPatch): Promise<Task> {
  const r = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `update failed: ${r.status}`);
  }
  return normTask(await r.json());
}

export async function deleteTask(id: string, version: number): Promise<void> {
  const r = await fetch(`/api/tasks/${id}?version=${version}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `delete failed: ${r.status}`);
  }
}

export interface CreateDependencyInput { predecessor_id: string; type?: DepType; lag_days?: number; }
export async function addDependency(taskId: string, input: CreateDependencyInput): Promise<Dependency> {
  const r = await fetch(`/api/tasks/${taskId}/dependencies`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `dep add failed: ${r.status}`);
  }
  const raw = await r.json() as Record<string, unknown>;
  return {
    id: String(raw["id"] ?? raw["ID"]),
    predecessorId: String(raw["predecessorId"] ?? raw["PredecessorID"] ?? raw["predecessor_id"]),
    successorId: String(raw["successorId"] ?? raw["SuccessorID"] ?? raw["successor_id"]),
    type: (raw["type"] ?? raw["Type"]) as DepType,
    lagDays: Number(raw["lagDays"] ?? raw["LagDays"] ?? raw["lag_days"] ?? 0),
  };
}
export async function removeDependency(depId: string): Promise<void> {
  const r = await fetch(`/api/dependencies/${depId}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`dep remove failed: ${r.status}`);
}

export async function listDepsForProject(projectId: string): Promise<Dependency[]> {
  const r = await fetch(`/api/projects/${projectId}/task-dependencies`);
  if (!r.ok) return [];
  const raw = await r.json() as Record<string, unknown>[];
  return (raw ?? []).map(d => ({
    id:            String(d["id"] ?? ""),
    predecessorId: String(d["predecessorId"] ?? ""),
    successorId:   String(d["successorId"] ?? ""),
    type:          (d["type"] ?? "fs") as DepType,
    lagDays:       Number(d["lagDays"] ?? 0),
  }));
}
