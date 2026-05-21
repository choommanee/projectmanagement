import { NextResponse } from "next/server";
import { currentTenantId } from "@/lib/auth/serverTenant";

export const AUDIT_URL = process.env.AUDIT_URL ?? "http://localhost:8091";

export async function makeHeaders(): Promise<Headers | NextResponse> {
  const tid = await currentTenantId();
  if (!tid) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  const h = new Headers();
  h.set("X-Tenant-Id", tid);
  return h;
}
