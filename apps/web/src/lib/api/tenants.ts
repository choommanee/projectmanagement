export interface Tenant {
  id: string;
  slug: string;
  name: string;
  tier: "shared" | "schema" | "dedicated";
  status: "active" | "suspended" | "archived";
  region: string;
  settings?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  version: number;
}

// tenant-svc returns Go-style uppercase keys (ID, Slug, ...); normalize
function normalize(raw: Record<string, unknown>): Tenant {
  return {
    id: String(raw.id ?? raw.ID),
    slug: String(raw.slug ?? raw.Slug),
    name: String(raw.name ?? raw.Name),
    tier: (raw.tier ?? raw.Tier) as Tenant["tier"],
    status: (raw.status ?? raw.Status) as Tenant["status"],
    region: String(raw.region ?? raw.Region),
    settings: (raw.settings ?? raw.Settings) as Record<string, unknown> | undefined,
    createdAt: (raw.createdAt ?? raw.CreatedAt) as string | undefined,
    updatedAt: (raw.updatedAt ?? raw.UpdatedAt) as string | undefined,
    version: Number(raw.version ?? raw.Version ?? 1),
  };
}

export async function listTenants(q: string, limit = 50, offset = 0): Promise<{ items: Tenant[]; total: number }> {
  const r = await fetch(`/api/tenants?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`);
  if (!r.ok) throw new Error(`list failed: ${r.status}`);
  const body = await r.json();
  return { items: (body.items as Record<string, unknown>[]).map(normalize), total: body.total };
}

export async function createTenant(input: { slug: string; name: string; tier?: Tenant["tier"]; region?: string }): Promise<Tenant> {
  const r = await fetch(`/api/tenants`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `create failed: ${r.status}`);
  return normalize(await r.json());
}

export async function updateTenant(
  id: string,
  patch: { name?: string; tier?: Tenant["tier"]; status?: Tenant["status"]; region?: string; version: number }
): Promise<Tenant> {
  const r = await fetch(`/api/tenants/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error ?? `update failed: ${r.status}`);
  }
  return normalize(await r.json());
}

export async function deleteTenant(id: string, version: number): Promise<void> {
  const r = await fetch(`/api/tenants/${id}?version=${version}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error ?? `delete failed: ${r.status}`);
  }
}
