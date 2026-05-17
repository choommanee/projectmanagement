import { NextResponse } from "next/server";
import { USER_COOKIE, DEMO_COOKIE, encodeUserMeta } from "@/lib/auth/cookies";
import type { UserMeta } from "@/lib/auth/cookies";

const TENANT_URL = process.env.TENANT_URL ?? "http://localhost:8081";

export async function POST() {
  // Resolve demo tenant ID
  let tenantId = process.env.DEMO_TENANT_ID ?? "";

  if (!tenantId) {
    try {
      const res = await fetch(`${TENANT_URL}/v1/tenants/by-slug/demo-co`);
      if (res.ok) {
        const body = await res.json() as { id?: string; ID?: string };
        tenantId = body.id ?? body.ID ?? "";
      }
    } catch {
      // ignore network error, fall through to error check
    }
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: "demo tenant not seeded — run tools/scripts/seed-demo.sh" },
      { status: 503 },
    );
  }

  const DEMO_USER: UserMeta = {
    id: "demo",
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
  response.cookies.set(USER_COOKIE, encodeUserMeta(DEMO_USER), {
    ...base,
    httpOnly: false,
  });

  return response;
}
