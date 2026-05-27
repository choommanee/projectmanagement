import { cookies } from "next/headers";

const IDENTITY_URL = process.env.IDENTITY_URL ?? "http://localhost:8082";

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

function isTokenExpiredOrMissing(token: string | null): boolean {
  if (!token) return true;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { exp?: number };
    if (!payload.exp) return false;
    // Treat as expired 60 seconds before actual expiry to avoid race conditions
    return Date.now() / 1000 >= payload.exp - 60;
  } catch {
    return true;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${IDENTITY_URL}/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

export async function proxyHeaders(): Promise<Headers | { error: string; status: number }> {
  const tid = await currentTenantId();
  if (!tid) return { error: "not authenticated", status: 401 };

  const jar = await cookies();
  let at = jar.get("access_token")?.value ?? null;

  // Auto-refresh if expired or missing
  if (isTokenExpiredOrMissing(at)) {
    const rt = jar.get("refresh_token")?.value;
    if (rt) {
      at = await refreshAccessToken(rt);
    }
  }

  const h = new Headers();
  h.set("X-Tenant-Id", tid);
  if (at) h.set("Authorization", `Bearer ${at}`);
  return h;
}
