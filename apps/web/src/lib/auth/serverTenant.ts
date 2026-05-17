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
