import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

export const MFG_URL = process.env.MFG_URL ?? "http://localhost:8085";

export async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (h instanceof Headers) return h;
  return NextResponse.json({ error: h.error }, { status: h.status });
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
  // Forward the destructive confirmation header if present
  const confirmHeader = req.headers.get("X-Confirm-Destructive");
  if (confirmHeader) h.set("X-Confirm-Destructive", confirmHeader);
  const url = new URL(req.url);
  const r = await fetch(`${backendUrl}?${url.searchParams}`, { method: "DELETE", headers: h });
  return new NextResponse(r.status === 204 ? null : await r.text(), { status: r.status, headers: r.status !== 204 ? { "content-type": "application/json" } : {} });
}
