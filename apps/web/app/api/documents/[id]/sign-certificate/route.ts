import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";
import { forwardClientContext } from "@/lib/auth/forwardIp";

const SVC = process.env.DOCUMENT_URL ?? "http://localhost:8084";

// GET /api/documents/{id}/sign-certificate → application/pdf (binary passthrough)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
  forwardClientContext(req, h);
  const url = new URL(req.url);
  const r = await fetch(`${SVC}/v1/documents/${id}/sign-certificate${url.search}`, { headers: h });

  const ct = r.headers.get("content-type") ?? "";
  if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
    const buf = await r.arrayBuffer();
    const out = new Headers();
    out.set("content-type", ct);
    const cd = r.headers.get("content-disposition");
    if (cd) out.set("content-disposition", cd);
    return new NextResponse(buf, { status: r.status, headers: out });
  }
  // Error path returns JSON
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
