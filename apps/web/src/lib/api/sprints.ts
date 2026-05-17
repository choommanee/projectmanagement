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

function get(raw: Record<string, unknown>, k: string) {
  return raw[k] ?? raw[k[0].toUpperCase() + k.slice(1)];
}

export function normSprint(raw: Record<string, unknown>): Sprint {
  return {
    id:          String(get(raw, "id") ?? raw["ID"] ?? ""),
    tenantId:    String(get(raw, "tenantId") ?? raw["TenantID"] ?? raw["tenant_id"] ?? ""),
    projectId:   String(get(raw, "projectId") ?? raw["ProjectID"] ?? raw["project_id"] ?? ""),
    name:        String(get(raw, "name") ?? ""),
    goal:        String(get(raw, "goal") ?? ""),
    status:      (get(raw, "status") ?? "planning") as SprintStatus,
    startDate:   (get(raw, "startDate") ?? raw["StartDate"] ?? raw["start_date"]) as string | null | undefined,
    endDate:     (get(raw, "endDate") ?? raw["EndDate"] ?? raw["end_date"]) as string | null | undefined,
    capacityPts: Number(get(raw, "capacityPts") ?? raw["CapacityPts"] ?? raw["capacity_pts"] ?? 0),
    createdAt:   String(get(raw, "createdAt") ?? raw["CreatedAt"] ?? ""),
    updatedAt:   String(get(raw, "updatedAt") ?? raw["UpdatedAt"] ?? ""),
    version:     Number(get(raw, "version") ?? 1),
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
