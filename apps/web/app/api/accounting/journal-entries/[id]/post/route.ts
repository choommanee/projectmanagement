import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const ACCT_URL = process.env.ACCT_URL ?? "http://localhost:8095";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  return h;
}

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${ACCT_URL}/v1/journal-entries/${id}/post`, { method: "POST", headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
