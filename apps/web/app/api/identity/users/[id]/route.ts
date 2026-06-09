import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.IDENTITY_URL ?? "http://localhost:8082";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const { id } = await ctx.params;
  const res = await fetch(`${SVC}/v1/users/${id}`, { headers: h, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const { id } = await ctx.params;
  const body = await req.text();
  const res = await fetch(`${SVC}/v1/users/${id}`, { method: "PATCH", headers: h, body });
  const text = await res.text();
  return new NextResponse(text || null, { status: res.status, headers: { "content-type": "application/json" } });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const { id } = await ctx.params;
  const res = await fetch(`${SVC}/v1/users/${id}`, { method: "DELETE", headers: h });
  return new NextResponse(null, { status: res.status });
}
