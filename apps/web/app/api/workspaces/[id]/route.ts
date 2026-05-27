import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.DOCUMENT_URL ?? "http://localhost:8084";

async function makeHeaders(): Promise<Headers | NextResponse> {
  const h = await proxyHeaders();
  if (h instanceof Headers) return h;
  return NextResponse.json({ error: h.error }, { status: h.status });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const { id } = await ctx.params;
  const r = await fetch(`${SVC}/v1/workspaces/${id}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
