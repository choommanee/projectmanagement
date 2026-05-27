import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.DOCUMENT_URL ?? "http://localhost:8084";

export async function POST(_: Request, ctx: { params: Promise<{ id: string; sigId: string }> }) {
  const { id, sigId } = await ctx.params;
  const h = await proxyHeaders();
  if (h instanceof Headers) {
    const r = await fetch(`${SVC}/v1/documents/${id}/signatures/${sigId}/sign`, { method: "POST", headers: h });
    return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  }
  return NextResponse.json({ error: h.error }, { status: h.status });
}
