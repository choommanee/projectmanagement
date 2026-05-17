import { NextResponse } from "next/server";
const SVC = process.env.TENANT_URL ?? "http://localhost:8081";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await fetch(`${SVC}/v1/tenants/${id}`);
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.text();
  const r = await fetch(`${SVC}/v1/tenants/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const r = await fetch(`${SVC}/v1/tenants/${id}?${url.searchParams.toString()}`, { method: "DELETE" });
  return new NextResponse(null, { status: r.status });
}
