export interface WorklogEntry {
  id: string;
  taskId: string;
  userId: string;
  loggedMd: number;
  workDate: string; // "YYYY-MM-DD" after normalization
  note: string;
  createdAt: string;
}

function normWorklog(r: Record<string, unknown>): WorklogEntry {
  return {
    id:        String(r["id"] ?? r["ID"] ?? ""),
    taskId:    String(r["task_id"] ?? r["TaskID"] ?? r["taskId"] ?? ""),
    userId:    String(r["user_id"] ?? r["UserID"] ?? r["userId"] ?? ""),
    loggedMd:  Number(r["logged_md"] ?? r["LoggedMd"] ?? r["loggedMd"] ?? 0),
    workDate:  String(r["work_date"] ?? r["WorkDate"] ?? r["workDate"] ?? "").slice(0, 10),
    note:      String(r["note"] ?? r["Note"] ?? ""),
    createdAt: String(r["created_at"] ?? r["CreatedAt"] ?? r["createdAt"] ?? ""),
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
