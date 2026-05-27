import { NextResponse } from "next/server";
import { USER_COOKIE, DEMO_COOKIE, ACCESS_COOKIE, REFRESH_COOKIE, encodeUserMeta } from "@/lib/auth/cookies";
import { verifyAccessToken } from "@/lib/auth/jwt-verify";
import type { UserMeta } from "@/lib/auth/cookies";

const TENANT_URL = process.env.TENANT_URL ?? "http://localhost:8081";
const IDENTITY_URL = process.env.IDENTITY_URL ?? "http://localhost:8082";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "DemoPass#2026";

export async function POST() {
  // 1. Resolve demo tenant ID
  let tenantId = process.env.DEMO_TENANT_ID ?? "";

  if (!tenantId) {
    try {
      const res = await fetch(`${TENANT_URL}/v1/tenants/by-slug/demo-co`);
      if (res.ok) {
        const body = await res.json() as { id?: string; ID?: string };
        tenantId = body.id ?? body.ID ?? "";
      }
    } catch {
      // ignore
    }
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: "demo tenant not seeded — run tools/scripts/seed-demo.sh" },
      { status: 503 },
    );
  }

  // 2. Get a real JWT from identity-svc so POST/PATCH/DELETE work
  let accessToken = "";
  let refreshToken = "";
  let userId = "";

  try {
    const loginRes = await fetch(`${IDENTITY_URL}/v1/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, email: "demo@demo.co", password: DEMO_PASSWORD }),
    });
    if (loginRes.ok) {
      const tokens = await loginRes.json() as { access_token?: string; refresh_token?: string };
      accessToken = tokens.access_token ?? "";
      refreshToken = tokens.refresh_token ?? "";
    }
  } catch {
    // identity-svc unavailable — fall through, writes will 401
  }

  // Extract user id from JWT sub claim
  if (accessToken) {
    const claims = await verifyAccessToken(accessToken).catch(() => null);
    userId = claims?.sub ?? userId;
  }

  const DEMO_USER: UserMeta = {
    id: userId || "demo",
    email: "demo@demo.co",
    displayName: "Demo User",
    tenantId,
    tenantSlug: "demo-co",
  };

  const response = NextResponse.json({ ok: true });

  const base = {
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60,
  };

  response.cookies.set(DEMO_COOKIE, "1", { ...base, httpOnly: true });
  response.cookies.set(USER_COOKIE, encodeUserMeta(DEMO_USER), { ...base, httpOnly: false });

  if (accessToken) {
    response.cookies.set(ACCESS_COOKIE, accessToken, { ...base, httpOnly: true, maxAge: 15 * 60 });
  }
  if (refreshToken) {
    response.cookies.set(REFRESH_COOKIE, refreshToken, { ...base, httpOnly: true });
  }

  return response;
}
