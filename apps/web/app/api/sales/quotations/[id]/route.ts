import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SALES_URL = process.env.SALES_URL ?? "http://localhost:8094";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${SALES_URL}/v1/quotations/${id}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SALES_URL}/v1/quotations/${id}`, { method: "PATCH", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function DELETE(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  // Backend has no hard-delete for quotations; cancel by setting status=rejected
  // First fetch current version, then patch status to rejected
  const gr = await fetch(`${SALES_URL}/v1/quotations/${id}`, { headers: h });
  if (!gr.ok) return new NextResponse(await gr.text(), { status: gr.status });
  const q = await gr.json() as Record<string, unknown>;
  const version = q.Version ?? q.version ?? 1;
  h.set("content-type", "application/json");
  const r = await fetch(`${SALES_URL}/v1/quotations/${id}`, {
    method: "PATCH", headers: h,
    body: JSON.stringify({ status: "rejected", version }),
  });
  return new NextResponse(r.status === 204 ? null : await r.text(), { status: r.status === 200 ? 204 : r.status });
}
