import { NextResponse } from "next/server";
import { currentTenantId, currentAccessToken } from "@/lib/auth/serverTenant";

const SVC = process.env.IDENTITY_URL ?? "http://localhost:8082";

async function proxyHeaders() {
  const [tid, at] = await Promise.all([currentTenantId(), currentAccessToken()]);
  if (!tid) return null;
  const h: Record<string, string> = { "X-Tenant-Id": tid };
  if (at) h["Authorization"] = `Bearer ${at}`;
  return h;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await proxyHeaders();
  if (!h) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const res = await fetch(`${SVC}/v1/users/${id}`, { headers: h, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await proxyHeaders();
  if (!h) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.text();
  const res = await fetch(`${SVC}/v1/users/${id}`, {
    method: "PATCH",
    headers: { ...h, "content-type": "application/json" },
    body,
  });
  const text = await res.text();
  return new NextResponse(text || null, { status: res.status, headers: { "content-type": "application/json" } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await proxyHeaders();
  if (!h) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const res = await fetch(`${SVC}/v1/users/${id}`, { method: "DELETE", headers: h });
  return new NextResponse(null, { status: res.status });
}
