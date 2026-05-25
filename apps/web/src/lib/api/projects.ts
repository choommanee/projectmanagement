export interface Project {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string;
  status: "planning" | "active" | "on_hold" | "completed" | "cancelled";
  ownerId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  progressPct: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

const SVC = "/api/projects";

function normalize(raw: Record<string, unknown>): Project {
  // Handles camelCase, PascalCase and common Go all-caps identifiers (ID, TenantID…)
  const get = (k: string) => raw[k] ?? raw[k[0].toUpperCase() + k.slice(1)];
  return {
    id: String(get("id") ?? raw["ID"] ?? ""),
    tenantId: String(get("tenantId") ?? raw["TenantID"] ?? raw["tenant_id"] ?? ""),
    code: String(get("code")),
    name: String(get("name")),
    description: String(get("description") ?? ""),
    status: (get("status") ?? "planning") as Project["status"],
    ownerId: (get("ownerId") ?? raw["OwnerID"] ?? raw["owner_id"]) as string | null | undefined,
    startDate: (get("startDate") ?? raw["StartDate"] ?? raw["start_date"]) as string | null | undefined,
    dueDate: (get("dueDate") ?? raw["DueDate"] ?? raw["due_date"]) as string | null | undefined,
    progressPct: Number(get("progressPct") ?? raw["ProgressPct"] ?? raw["progress_pct"] ?? 0),
    tags: (get("tags") ?? []) as string[],
    createdAt: String(get("createdAt") ?? raw["CreatedAt"] ?? ""),
    updatedAt: String(get("updatedAt") ?? raw["UpdatedAt"] ?? ""),
    version: Number(get("version") ?? 1),
  };
}

export async function listProjects(
  params: { q?: string; status?: string; limit?: number; offset?: number } = {},
): Promise<{ items: Project[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.status) qs.set("status", params.status);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("offset", String(params.offset ?? 0));
  const r = await fetch(`${SVC}?${qs}`);
  if (!r.ok) throw new Error(`list failed: ${r.status}`);
  const body = await r.json();
  return {
    items: (body.items as Record<string, unknown>[] | null ?? []).map(normalize),
    total: body.total ?? 0,
  };
}

export async function getProject(id: string): Promise<Project> {
  const r = await fetch(`${SVC}/${id}`);
  if (!r.ok) throw new Error(`get failed: ${r.status}`);
  return normalize(await r.json());
}

export async function createProject(input: {
  code: string;
  name: string;
  description?: string;
  status?: Project["status"];
}): Promise<Project> {
  const r = await fetch(SVC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `create failed: ${r.status}`);
  }
  return normalize(await r.json());
}

export async function updateProject(
  id: string,
  patch: {
    name?: string;
    description?: string;
    status?: Project["status"];
    owner_id?: string | null;
    progress_pct?: number;
    start_date?: string | null;
    due_date?: string | null;
    tags?: string[];
    version: number;
  },
): Promise<Project> {
  const r = await fetch(`${SVC}/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `update failed: ${r.status}`);
  }
  return normalize(await r.json());
}

export async function deleteProject(id: string, version: number): Promise<void> {
  const r = await fetch(`${SVC}/${id}?version=${version}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `delete failed: ${r.status}`);
  }
}
