import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const ACCT_URL = process.env.ACCT_URL ?? "http://localhost:8095";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${ACCT_URL}/v1/journal-entries/${id}/lines/${lineId}`, { method: "PATCH", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${ACCT_URL}/v1/journal-entries/${id}/lines/${lineId}`, { method: "DELETE", headers: h });
  return new NextResponse(r.status === 204 ? null : await r.text(), {
    status: r.status,
    headers: r.status !== 204 ? { "content-type": "application/json" } : {},
  });
}
