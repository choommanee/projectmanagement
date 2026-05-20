import { NextResponse } from "next/server";
import { currentTenantId } from "@/lib/auth/serverTenant";

export const MFG_URL = process.env.MFG_URL ?? "http://localhost:8085";

export async function makeHeaders(): Promise<Headers | NextResponse> {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const h = new Headers();
  h.set("X-Tenant-Id", tid);
  return h;
}

export async function proxyGet(backendUrl: string): Promise<NextResponse> {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(backendUrl, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function proxyPost(backendUrl: string, req: Request): Promise<NextResponse> {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(backendUrl, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function proxyPatch(backendUrl: string, req: Request): Promise<NextResponse> {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(backendUrl, { method: "PATCH", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function proxyDelete(backendUrl: string, req: Request): Promise<NextResponse> {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const url = new URL(req.url);
  const r = await fetch(`${backendUrl}?${url.searchParams}`, { method: "DELETE", headers: h });
  return new NextResponse(r.status === 204 ? null : await r.text(), { status: r.status, headers: r.status !== 204 ? { "content-type": "application/json" } : {} });
}
