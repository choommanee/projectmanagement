import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.PROJECT_URL ?? "http://localhost:8083";

async function withTenant(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (h instanceof Headers) return h;
  return NextResponse.json({ error: h.error }, { status: h.status });
}

export async function GET(req: Request) {
  const headers = await withTenant();
  if (headers instanceof NextResponse) return headers;
  const url = new URL(req.url);
  const r = await fetch(`${SVC}/v1/projects?${url.searchParams.toString()}`, { headers });
  const text = await r.text();
  return new NextResponse(text, { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const headers = await withTenant();
  if (headers instanceof NextResponse) return headers;
  headers.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SVC}/v1/projects`, { method: "POST", headers, body });
  const text = await r.text();
  return new NextResponse(text, { status: r.status, headers: { "content-type": "application/json" } });
}
