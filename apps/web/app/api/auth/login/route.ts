import { NextRequest, NextResponse } from "next/server";
import { setAuthCookies } from "@/lib/auth/cookies";
import { verifyAccessToken } from "@/lib/auth/jwt-verify";
import type { UserMeta } from "@/lib/auth/cookies";

const IDENTITY_URL =
  process.env.IDENTITY_URL ?? "http://localhost:8082";
const TENANT_URL =
  process.env.TENANT_URL ?? "http://localhost:8081";

export async function POST(req: NextRequest) {
  let body: {
    tenant_id?: string;
    tenant_slug?: string;
    email: string;
    password: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  const { email, password } = body;
  let tenantId = body.tenant_id;

  // Resolve slug → UUID if needed
  if (!tenantId && body.tenant_slug) {
    const slugRes = await fetch(
      `${TENANT_URL}/v1/tenants/by-slug/${encodeURIComponent(body.tenant_slug)}`,
    );
    if (!slugRes.ok) {
      const status = slugRes.status === 404 ? 404 : 502;
      return NextResponse.json(
        { error: `Tenant '${body.tenant_slug}' not found` },
        { status },
      );
    }
    const tenant = await slugRes.json() as { id?: string; ID?: string };
    tenantId = tenant.id ?? tenant.ID;
  }

  if (!tenantId) {
    return NextResponse.json(
      { error: "tenant_id or tenant_slug is required" },
      { status: 400 },
    );
  }

  // Proxy to identity-svc
  let idRes: Response;
  try {
    idRes = await fetch(`${IDENTITY_URL}/v1/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, email, password }),
    });
  } catch {
    return NextResponse.json(
      { error: "Cannot reach identity service" },
      { status: 503 },
    );
  }

  if (idRes.status === 401) {
    return NextResponse.json(
      { error: "invalid credentials" },
      { status: 401 },
    );
  }

  if (!idRes.ok) {
    return NextResponse.json(
      { error: "Server error, please try again" },
      { status: idRes.status >= 500 ? 502 : idRes.status },
    );
  }

  const tokens = await idRes.json() as {
    access_token: string;
    refresh_token: string;
    expires_at: string;
  };

  // Decode JWT to get user metadata
  const claims = await verifyAccessToken(tokens.access_token);
  const sub = claims?.sub ?? "";
  const tid = claims?.tid ?? tenantId;

  // Derive displayName from email local part (Phase 1)
  const displayName =
    email
      .split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()) || email;

  // Resolve tenant slug (best-effort)
  let tenantSlug = body.tenant_slug ?? "";
  if (!tenantSlug) {
    try {
      const tRes = await fetch(`${TENANT_URL}/v1/tenants/${tid}`);
      if (tRes.ok) {
        const t = await tRes.json() as { slug?: string; Slug?: string };
        tenantSlug = t.slug ?? t.Slug ?? "";
      }
    } catch {
      // ignore
    }
  }

  const user: UserMeta = {
    id: sub,
    email,
    displayName,
    tenantId: tid,
    tenantSlug,
  };

  const response = NextResponse.json({ ok: true, user });
  setAuthCookies(response, tokens, user);
  return response;
}
