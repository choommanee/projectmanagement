import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.PROJECT_URL ?? "http://localhost:8083";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (h instanceof Headers) return h;
  return NextResponse.json({ error: h.error }, { status: h.status });
}

export async function POST(_: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${SVC}/v1/sprints/${id}/tasks/${taskId}`, { method: "POST", headers: h });
  return new NextResponse(null, { status: r.status });
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${SVC}/v1/sprints/${id}/tasks/${taskId}`, { method: "DELETE", headers: h });
  return new NextResponse(null, { status: r.status });
}
