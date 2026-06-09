import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";
import { forwardClientContext } from "@/lib/auth/forwardIp";

const SVC = process.env.DOCUMENT_URL ?? "http://localhost:8084";

// GET /api/documents/{id}/sign-audit → { items, total }
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  forwardClientContext(req, h);
  const url = new URL(req.url);
  const r = await fetch(`${SVC}/v1/documents/${id}/sign-audit${url.search}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
