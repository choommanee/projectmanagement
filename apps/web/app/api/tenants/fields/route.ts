import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.TENANT_URL ?? "http://localhost:8081";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.searchParams.toString();
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) {
    return NextResponse.json({ error: h.error }, { status: h.status });
  }
  const r = await fetch(`${SVC}/v1/custom-fields${qs ? "?" + qs : ""}`, { headers: h });
  return new NextResponse(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request) {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) {
    return NextResponse.json({ error: h.error }, { status: h.status });
  }
  h.set("content-type", "application/json");
  const body = await req.text();
  const r = await fetch(`${SVC}/v1/custom-fields`, {
    method: "POST",
    headers: h,
    body,
  });
  return new NextResponse(await r.text(), {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
}
