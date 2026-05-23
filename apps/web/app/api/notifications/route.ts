import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.NOTIF_URL ?? "http://localhost:8093";

async function withTenant() {
  const h = await proxyHeaders();
  if (h instanceof Headers) return h;
  return NextResponse.json({ error: h.error }, { status: h.status });
}

export async function GET(req: Request) {
  const headers = await withTenant();
  if (headers instanceof NextResponse) return headers;
  const url = new URL(req.url);
  const r = await fetch(`${SVC}/v1/notifications?${url.searchParams.toString()}`, { headers });
  const text = await r.text();
  return new NextResponse(text, { status: r.status, headers: { "content-type": "application/json" } });
}
