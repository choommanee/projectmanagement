export interface AppNotification {
  id: string;
  tenantId: string;
  userId: string;
  kind: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

const SVC = "/api/notifications";

function normNotif(raw: Record<string, unknown>): AppNotification {
  const g = (k: string) => raw[k] ?? raw[k[0].toUpperCase() + k.slice(1)];
  return {
    id:        String(g("id") ?? raw["ID"] ?? ""),
    tenantId:  String(g("tenantId") ?? raw["TenantID"] ?? raw["tenant_id"] ?? ""),
    userId:    String(g("userId") ?? raw["UserID"] ?? raw["user_id"] ?? ""),
    kind:      String(g("kind") ?? ""),
    title:     String(g("title") ?? ""),
    body:      String(g("body") ?? ""),
    payload:   (g("payload") ?? {}) as Record<string, unknown>,
    readAt:    (g("readAt") ?? raw["ReadAt"] ?? raw["read_at"] ?? null) as string | null,
    createdAt: String(g("createdAt") ?? raw["CreatedAt"] ?? ""),
  };
}

export async function listNotifications(
  params: { unread?: boolean; limit?: number; offset?: number } = {},
): Promise<{ items: AppNotification[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.unread) qs.set("unread", "true");
  qs.set("limit", String(params.limit ?? 50));
  qs.set("offset", String(params.offset ?? 0));
  const r = await fetch(`${SVC}?${qs}`);
  if (!r.ok) throw new Error(`list failed: ${r.status}`);
  const body = await r.json();
  return {
    items: (body.items as Record<string, unknown>[] ?? []).map(normNotif),
    total: body.total ?? 0,
  };
}

export async function markRead(id: string): Promise<void> {
  const r = await fetch(`${SVC}/${id}/read`, { method: "POST" });
  if (!r.ok) throw new Error(`mark-read failed: ${r.status}`);
}

export async function markAllRead(): Promise<void> {
  const r = await fetch(`${SVC}/read-all`, { method: "POST" });
  if (!r.ok) throw new Error(`mark-all-read failed: ${r.status}`);
}
