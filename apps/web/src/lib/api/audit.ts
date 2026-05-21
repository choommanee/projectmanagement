// Audit API client — proxies through Next.js /api/audit catch-all route

export interface AuditEvent {
  id: string;
  ts: string;
  tenantId: string;
  userId: string;
  service: string;
  action: string;
  entityType: string;
  entityId: string;
  ip: string;
  result: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
}

export interface Bucket {
  day: string;     // "YYYY-MM-DD"
  service: string;
  count: number;
}

export interface ListAuditOpts {
  service?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  result?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// Normalize Go PascalCase/snake_case → camelCase
function normalize(r: Record<string, unknown>): AuditEvent {
  const g = (k: string, snake?: string): unknown =>
    r[k] ?? r[k[0].toUpperCase() + k.slice(1)] ??
    r[k.replace(/([A-Z])/g, "_$1").toLowerCase()] ??
    (snake ? r[snake] : undefined);

  return {
    id:         String(g("id") ?? ""),
    ts:         String(g("ts") ?? g("Timestamp") ?? ""),
    tenantId:   String(g("tenantId") ?? g("TenantID") ?? g("tenant_id") ?? ""),
    userId:     String(g("userId") ?? g("UserID") ?? g("user_id") ?? ""),
    service:    String(g("service") ?? g("Service") ?? ""),
    action:     String(g("action") ?? g("Action") ?? ""),
    entityType: String(g("entityType") ?? g("EntityType") ?? g("entity_type") ?? ""),
    entityId:   String(g("entityId") ?? g("EntityID") ?? g("entity_id") ?? ""),
    ip:         String(g("ip") ?? g("IP") ?? ""),
    result:     String(g("result") ?? g("Result") ?? ""),
    before:     (g("before") ?? g("Before") ?? null) as Record<string, unknown> | null,
    after:      (g("after") ?? g("After") ?? null) as Record<string, unknown> | null,
    meta:       (g("meta") ?? g("Meta") ?? null) as Record<string, unknown> | null,
  };
}

export async function listAudit(
  opts: ListAuditOpts = {}
): Promise<{ items: AuditEvent[]; total: number }> {
  const params = new URLSearchParams();
  if (opts.service)    params.set("service",      opts.service);
  if (opts.action)     params.set("action",       opts.action);
  if (opts.entityType) params.set("entity_type",  opts.entityType);
  if (opts.entityId)   params.set("entity_id",    opts.entityId);
  if (opts.userId)     params.set("user_id",      opts.userId);
  if (opts.result)     params.set("result",       opts.result);
  if (opts.q)          params.set("q",            opts.q);
  if (opts.from)       params.set("from",         opts.from);
  if (opts.to)         params.set("to",           opts.to);
  if (opts.limit)      params.set("limit",        String(opts.limit));
  if (opts.offset)     params.set("offset",       String(opts.offset));

  // /api/audit (no path segment) — handled by apps/web/app/api/audit/route.ts
  const res = await fetch(`/api/audit?${params.toString()}`);
  if (!res.ok) throw new Error(`audit list failed: ${res.status}`);
  const data = await res.json() as { items?: unknown[]; total?: number };
  const raw = data.items ?? [];
  return {
    items: raw.map((r) => normalize(r as Record<string, unknown>)),
    total: data.total ?? raw.length,
  };
}

export async function getAudit(id: string): Promise<AuditEvent> {
  // /api/audit/[...path] catch-all: path=[id] → /v1/audit/{id}
  const res = await fetch(`/api/audit/${id}`);
  if (!res.ok) throw new Error(`audit get failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return normalize(data);
}

export async function getBuckets(days = 14): Promise<Bucket[]> {
  // /api/audit/buckets — handled by apps/web/app/api/audit/buckets/route.ts
  const res = await fetch(`/api/audit/buckets?days=${days}`);
  if (!res.ok) throw new Error(`audit buckets failed: ${res.status}`);
  const data = await res.json() as unknown[];
  if (!Array.isArray(data)) return [];
  return data.map((b) => {
    const r = b as Record<string, unknown>;
    return {
      day:     String(r.day ?? r.Day ?? ""),
      service: String(r.service ?? r.Service ?? ""),
      count:   Number(r.count ?? r.Count ?? 0),
    };
  });
}
