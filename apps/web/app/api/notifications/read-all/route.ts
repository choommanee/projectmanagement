import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.NOTIF_URL ?? "http://localhost:8093";

export async function POST() {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  const r = await fetch(`${SVC}/v1/notifications/read-all`, { method: "POST", headers: h });
  return new NextResponse(null, { status: r.status });
}
