import { NextResponse } from "next/server";

const SVC = process.env.DOCUMENT_URL ?? "http://localhost:8084";

/**
 * PUBLIC verification proxy — deliberately NO session, NO proxyHeaders(), NO
 * tenant header: the 256-bit token in the path is the sole credential and
 * document-svc's /public/verify/{token} endpoint is unauthenticated by
 * design. Unknown / revoked / expired tokens come back as an
 * indistinguishable 404.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token || token.length > 128) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const r = await fetch(`${SVC}/public/verify/${encodeURIComponent(token)}`, {
    cache: "no-store",
  });
  const text = await r.text();
  return new NextResponse(text || null, {
    status: r.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
