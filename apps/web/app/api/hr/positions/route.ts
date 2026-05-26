import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const HR_URL = process.env.HR_URL ?? "http://localhost:8096";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function GET(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const url = new URL(req.url);
  const r = await fetch(`${HR_URL}/v1/positions?${url.searchParams}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${HR_URL}/v1/positions`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
