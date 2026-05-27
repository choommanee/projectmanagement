import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.NOTIF_URL ?? "http://localhost:8093";

async function getHeaders() {
  const h = await proxyHeaders();
  if (h instanceof Headers) return h;
  return NextResponse.json({ error: h.error }, { status: h.status });
}

export async function GET() {
  const headers = await getHeaders();
  if (headers instanceof NextResponse) return headers;
  try {
    const r = await fetch(`${SVC}/v1/notification-preferences`, { headers });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const headers = await getHeaders();
  if (headers instanceof NextResponse) return headers;
  const body = await req.text();
  try {
    const r = await fetch(`${SVC}/v1/notification-preferences`, {
      method: "PUT",
      headers: new Headers([...headers.entries(), ["content-type", "application/json"]]),
      body,
    });
    const text = await r.text();
    return new NextResponse(text, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "upstream unavailable" }, { status: 502 });
  }
}
