import type { Task as TaskT } from "./tasks";

export type SprintStatus = "planning" | "active" | "closed";

export interface Sprint {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  goal: string;
  status: SprintStatus;
  startDate?: string | null;
  endDate?: string | null;
  capacityPts: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// Backend is canonical snake_case — map once, cleanly.
export function normSprint(raw: Record<string, unknown>): Sprint {
  return {
    id:          String(raw["id"] ?? ""),
    tenantId:    String(raw["tenant_id"] ?? ""),
    projectId:   String(raw["project_id"] ?? ""),
    name:        String(raw["name"] ?? ""),
    goal:        String(raw["goal"] ?? ""),
    status:      (raw["status"] ?? "planning") as SprintStatus,
    startDate:   (raw["start_date"] ?? null) as string | null,
    endDate:     (raw["end_date"] ?? null) as string | null,
    capacityPts: Number(raw["capacity_pts"] ?? 0),
    createdAt:   String(raw["created_at"] ?? ""),
    updatedAt:   String(raw["updated_at"] ?? ""),
    version:     Number(raw["version"] ?? 1),
  };
}

export async function listSprintsForProject(projectId: string): Promise<Sprint[]> {
  const r = await fetch(`/api/projects/${projectId}/sprints`);
  if (!r.ok) throw new Error(`list sprints failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return (arr ?? []).map(normSprint);
}

export async function getSprint(id: string): Promise<Sprint> {
  const r = await fetch(`/api/sprints/${id}`);
  if (!r.ok) throw new Error(`get sprint failed: ${r.status}`);
  return normSprint(await r.json());
}

export interface CreateSprintInput {
  name: string;
  goal?: string;
  status?: SprintStatus;
  start_date?: string;
  end_date?: string;
  capacity_pts?: number;
}

export async function createSprint(projectId: string, input: CreateSprintInput): Promise<Sprint> {
  const r = await fetch(`/api/projects/${projectId}/sprints`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `create sprint failed: ${r.status}`);
  }
  return normSprint(await r.json());
}

export async function updateSprint(id: string, patch: Partial<CreateSprintInput> & { version: number }): Promise<Sprint> {
  const r = await fetch(`/api/sprints/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `update sprint failed: ${r.status}`);
  }
  return normSprint(await r.json());
}

export async function assignTaskToSprint(sprintId: string, taskId: string): Promise<void> {
  const r = await fetch(`/api/sprints/${sprintId}/tasks/${taskId}`, { method: "POST" });
  if (!r.ok) throw new Error(`assign failed: ${r.status}`);
}

export async function unassignTaskFromSprint(sprintId: string, taskId: string): Promise<void> {
  const r = await fetch(`/api/sprints/${sprintId}/tasks/${taskId}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`unassign failed: ${r.status}`);
}

export async function listSprintTasks(sprintId: string): Promise<TaskT[]> {
  const r = await fetch(`/api/sprints/${sprintId}/tasks`);
  if (!r.ok) throw new Error(`list sprint tasks failed: ${r.status}`);
  const body = await r.json();
  const items = (body.items ?? body) as Record<string, unknown>[] | null;
  const { normTask } = await import("./tasks");
  return (items ?? []).map((x) => normTask(x as Record<string, unknown>));
}

// Soft-delete, version-guarded: DELETE /v1/sprints/{id}?version=N (409 on mismatch).
export async function deleteSprint(id: string, version: number): Promise<void> {
  const r = await fetch(`/api/sprints/${id}?version=${version}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({})) as Record<string, string>;
    throw new Error(e.error ?? `delete sprint failed: ${r.status}`);
  }
}
