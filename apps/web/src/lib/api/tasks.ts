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

// Backend is canonical snake_case — map once, cleanly.
export function normTask(raw: Record<string, unknown>): Task {
  return {
    id:          String(raw["id"] ?? ""),
    tenantId:    String(raw["tenant_id"] ?? ""),
    projectId:   String(raw["project_id"] ?? ""),
    parentId:    (raw["parent_id"] ?? null) as string | null,
    code:        String(raw["code"] ?? ""),
    title:       String(raw["title"] ?? ""),
    description: String(raw["description"] ?? ""),
    type:        (raw["type"] ?? "task") as TaskType,
    status:      (raw["status"] ?? "todo") as TaskStatus,
    priority:    (raw["priority"] ?? "med") as TaskPriority,
    assigneeId:  (raw["assignee_id"] ?? null) as string | null,
    reviewerId:  (raw["reviewer_id"] ?? null) as string | null,
    estimateMd:  Number(raw["estimate_md"] ?? 0),
    actualMd:    Number(raw["actual_md"] ?? 0),
    progressPct: Number(raw["progress_pct"] ?? 0),
    startDate:   (raw["start_date"] ?? null) as string | null,
    dueDate:     (raw["due_date"] ?? null) as string | null,
    sortOrder:   Number(raw["sort_order"] ?? 0),
    tags:        (raw["tags"] as string[] | null) ?? [],
    createdAt:   String(raw["created_at"] ?? ""),
    updatedAt:   String(raw["updated_at"] ?? ""),
    version:     Number(raw["version"] ?? 1),
  };
}

function normDep(raw: Record<string, unknown>): Dependency {
  return {
    id:            String(raw["id"] ?? ""),
    predecessorId: String(raw["predecessor_id"] ?? ""),
    successorId:   String(raw["successor_id"] ?? ""),
    type:          (raw["type"] ?? "fs") as DepType,
    lagDays:       Number(raw["lag_days"] ?? 0),
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

// ─── Dependencies ───────────────────────────────────────────────────────────────
// POST /v1/tasks/{successorId}/dependencies  body {predecessor_id, type, lag_days}

export interface CreateDependencyInput { predecessor_id: string; type?: DepType; lag_days?: number; }

export async function addDependency(successorTaskId: string, input: CreateDependencyInput): Promise<Dependency> {
  const r = await fetch(`/api/tasks/${successorTaskId}/dependencies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ predecessor_id: input.predecessor_id, type: input.type ?? "fs", lag_days: input.lag_days ?? 0 }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `dep add failed: ${r.status}`);
  }
  return normDep(await r.json() as Record<string, unknown>);
}

export async function removeDependency(depId: string): Promise<void> {
  const r = await fetch(`/api/dependencies/${depId}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `dep remove failed: ${r.status}`);
  }
}

export async function listDepsForProject(projectId: string): Promise<Dependency[]> {
  const r = await fetch(`/api/projects/${projectId}/task-dependencies`);
  if (!r.ok) return [];
  const body = await r.json();
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return (arr ?? []).map(normDep);
}

// ─── Task comments ──────────────────────────────────────────────────────────────
// GET/POST /v1/tasks/{id}/comments ; PATCH/DELETE /v1/comments/{id}

export interface TaskComment {
  id: string;
  tenantId: string;
  taskId: string;
  authorId: string;
  body: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

function normComment(raw: Record<string, unknown>): TaskComment {
  return {
    id:        String(raw["id"] ?? ""),
    tenantId:  String(raw["tenant_id"] ?? ""),
    taskId:    String(raw["task_id"] ?? ""),
    authorId:  String(raw["author_id"] ?? ""),
    body:      String(raw["body"] ?? ""),
    version:   Number(raw["version"] ?? 1),
    createdAt: String(raw["created_at"] ?? ""),
    updatedAt: String(raw["updated_at"] ?? ""),
  };
}

export async function listComments(taskId: string): Promise<TaskComment[]> {
  const r = await fetch(`/api/tasks/${taskId}/comments`);
  if (!r.ok) throw new Error(`list comments failed: ${r.status}`);
  const body = await r.json();
  return ((body.items as Record<string, unknown>[] | null) ?? []).map(normComment);
}

export async function createComment(taskId: string, authorId: string, body: string): Promise<TaskComment> {
  const r = await fetch(`/api/tasks/${taskId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, author_id: authorId }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `create comment failed: ${r.status}`);
  }
  return normComment(await r.json());
}

export async function updateComment(commentId: string, body: string, version: number): Promise<TaskComment> {
  const r = await fetch(`/api/pm/comments/${commentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, version }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `update comment failed: ${r.status}`);
  }
  return normComment(await r.json());
}

export async function deleteComment(commentId: string, version: number): Promise<void> {
  const r = await fetch(`/api/pm/comments/${commentId}?version=${version}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `delete comment failed: ${r.status}`);
  }
}
