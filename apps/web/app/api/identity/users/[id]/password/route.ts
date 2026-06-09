import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.IDENTITY_URL ?? "http://localhost:8082";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  h.set("content-type", "application/json");
  const { id } = await ctx.params;
  const body = await req.text();
  const res = await fetch(`${SVC}/v1/users/${id}/password`, { method: "POST", headers: h, body });
  const text = await res.text();
  return new NextResponse(text || null, {
    status: res.status,
    headers: res.status !== 204 ? { "content-type": "application/json" } : {},
  });
}
