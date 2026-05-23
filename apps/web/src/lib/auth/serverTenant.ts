import { cookies } from "next/headers";

export async function currentTenantId(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get("user_meta")?.value;
  if (!raw) return null;
  try {
    const meta = JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
    return (meta.tenantId as string) || (meta.tenant_id as string) || null;
  } catch {
    return null;
  }
}

export async function currentAccessToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get("access_token")?.value ?? null;
}

export async function proxyHeaders(): Promise<Headers | { error: string; status: number }> {
  const tid = await currentTenantId();
  if (!tid) return { error: "not authenticated", status: 401 };
  const h = new Headers();
  h.set("X-Tenant-Id", tid);
  const at = await currentAccessToken();
  if (at) h.set("Authorization", `Bearer ${at}`);
  return h;
}
