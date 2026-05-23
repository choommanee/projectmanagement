import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

export const AUDIT_URL = process.env.AUDIT_URL ?? "http://localhost:8091";

export async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (h instanceof Headers) return h;
  return NextResponse.json({ error: h.error }, { status: h.status });
}
