import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const HR_URL = process.env.HR_URL ?? "http://localhost:8096";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: (h as { error: string }).error }, { status: 401 });
  return h;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const { id } = await params;
  const r = await fetch(`${HR_URL}/v1/jobs/${id}/applicants`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const { id } = await params;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${HR_URL}/v1/jobs/${id}/applicants`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
