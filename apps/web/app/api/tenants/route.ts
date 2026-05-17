import { NextResponse } from "next/server";
const SVC = process.env.TENANT_URL ?? "http://localhost:8081";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const r = await fetch(`${SVC}/v1/tenants?${url.searchParams.toString()}`);
  const body = await r.text();
  return new NextResponse(body, { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  const body = await req.text();
  const r = await fetch(`${SVC}/v1/tenants`, { method: "POST", headers: { "content-type": "application/json" }, body });
  const text = await r.text();
  return new NextResponse(text, { status: r.status, headers: { "content-type": "application/json" } });
}
