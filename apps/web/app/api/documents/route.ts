import { NextResponse } from "next/server";
import { currentTenantId } from "@/lib/auth/serverTenant";

const SVC = process.env.DOCUMENT_URL ?? "http://localhost:8084";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const h = new Headers();
  h.set("X-Tenant-Id", tid);
  return h;
}

export async function GET(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const url = new URL(req.url);
  const r = await fetch(`${SVC}/v1/documents?${url.searchParams.toString()}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SVC}/v1/documents`, { method: "POST", headers: h, body });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
