export interface WorklogEntry {
  id: string;
  tenantId: string;
  taskId: string;
  userId: string;
  loggedMd: number;
  workDate: string; // "YYYY-MM-DD" after normalization
  note: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// Backend is canonical snake_case — map once, cleanly.
function normWorklog(r: Record<string, unknown>): WorklogEntry {
  return {
    id:        String(r["id"] ?? ""),
    tenantId:  String(r["tenant_id"] ?? ""),
    taskId:    String(r["task_id"] ?? ""),
    userId:    String(r["user_id"] ?? ""),
    loggedMd:  Number(r["logged_md"] ?? 0),
    workDate:  String(r["work_date"] ?? "").slice(0, 10),
    note:      String(r["note"] ?? ""),
    version:   Number(r["version"] ?? 1),
    createdAt: String(r["created_at"] ?? ""),
    updatedAt: String(r["updated_at"] ?? ""),
  };
}

export async function listWorklogs(taskId: string): Promise<WorklogEntry[]> {
  const res = await fetch(`/api/tasks/${taskId}/worklog`);
  if (!res.ok) throw new Error(`Failed to fetch worklogs: ${res.status}`);
  const data = await res.json() as { items?: Record<string, unknown>[] };
  return (data.items ?? []).map(normWorklog);
}

export async function createWorklog(
  taskId: string,
  params: { userId: string; loggedMd: number; workDate: string; note: string },
): Promise<WorklogEntry> {
  const res = await fetch(`/api/tasks/${taskId}/worklog`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user_id:   params.userId,
      logged_md: params.loggedMd,
      work_date: params.workDate,
      note:      params.note,
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(e["error"] ?? `Failed to create worklog: ${res.status}`);
  }
  return normWorklog(await res.json() as Record<string, unknown>);
}

// PATCH /v1/worklogs/{id} body {logged_md?, work_date?, note?, version}
export async function updateWorklog(
  id: string,
  patch: { loggedMd?: number; workDate?: string; note?: string; version: number },
): Promise<WorklogEntry> {
  const body: Record<string, unknown> = { version: patch.version };
  if (patch.loggedMd !== undefined) body.logged_md = patch.loggedMd;
  if (patch.workDate !== undefined) body.work_date = patch.workDate;
  if (patch.note !== undefined) body.note = patch.note;
  const res = await fetch(`/api/pm/worklogs/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(e["error"] ?? `Failed to update worklog: ${res.status}`);
  }
  return normWorklog(await res.json() as Record<string, unknown>);
}

// DELETE /v1/worklogs/{id}?version=N
export async function deleteWorklog(id: string, version: number): Promise<void> {
  const res = await fetch(`/api/pm/worklogs/${id}?version=${version}`, { method: "DELETE" });
  if (!res.ok) {
    const e = await res.json().catch(() => ({})) as Record<string, string>;
    throw new Error(e["error"] ?? `Failed to delete worklog: ${res.status}`);
  }
}
