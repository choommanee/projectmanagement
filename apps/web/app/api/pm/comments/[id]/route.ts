import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

// Task comments live on project-svc (:8083) at /v1/comments/{id}.
// Kept under /api/pm/ so it does not collide with /api/comments/{id},
// which proxies document-svc (:8084) for document comments.
const SVC = process.env.PROJECT_URL ?? "http://localhost:8083";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (h instanceof Headers) return h;
  return NextResponse.json({ error: h.error }, { status: h.status });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SVC}/v1/comments/${id}`, { method: "PATCH", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const url = new URL(req.url);
  const r = await fetch(`${SVC}/v1/comments/${id}?${url.searchParams.toString()}`, { method: "DELETE", headers: h });
  return new NextResponse(r.status === 204 ? null : await r.text(), {
    status: r.status,
    headers: r.status !== 204 ? { "content-type": "application/json" } : {},
  });
}
