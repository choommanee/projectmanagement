import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.PROJECT_URL ?? "http://localhost:8083";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (h instanceof Headers) return h;
  return NextResponse.json({ error: h.error }, { status: h.status });
}

export async function GET(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const url = new URL(req.url);
  const r = await fetch(`${SVC}/v1/tasks?${url.searchParams.toString()}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
