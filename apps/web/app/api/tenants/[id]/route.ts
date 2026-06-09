import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.TENANT_URL ?? "http://localhost:8081";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${SVC}/v1/tenants/${id}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SVC}/v1/tenants/${id}`, { method: "PATCH", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  // Cedar requires X-Confirm-Destructive: true for tenant.delete. Forward the
  // confirmation from the client (the UI gates this behind a slug-confirm).
  const confirm = req.headers.get("x-confirm-destructive");
  if (confirm) h.set("X-Confirm-Destructive", confirm);
  const url = new URL(req.url);
  const r = await fetch(`${SVC}/v1/tenants/${id}?${url.searchParams.toString()}`, { method: "DELETE", headers: h });
  return new NextResponse(r.status === 204 ? null : await r.text(), {
    status: r.status,
    headers: r.status !== 204 ? { "content-type": "application/json" } : {},
  });
}
