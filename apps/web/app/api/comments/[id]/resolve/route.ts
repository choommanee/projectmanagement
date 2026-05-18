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

export async function PATCH(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${SVC}/v1/comments/${id}/resolve`, { method: "PATCH", headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
