import { NextResponse } from "next/server";
import { currentTenantId, currentAccessToken } from "@/lib/auth/serverTenant";

const SVC = process.env.IDENTITY_URL ?? "http://localhost:8082";

export async function GET(req: Request) {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const at = await currentAccessToken();
  const url = new URL(req.url);
  const target = `${SVC}/v1/users${url.search}`;
  const headers: Record<string, string> = { "X-Tenant-Id": tid };
  if (at) headers["Authorization"] = `Bearer ${at}`;
  const res = await fetch(target, { headers, cache: "no-store" });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
