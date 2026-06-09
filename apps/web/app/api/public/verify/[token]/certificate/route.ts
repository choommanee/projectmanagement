import { NextResponse } from "next/server";

const SVC = process.env.DOCUMENT_URL ?? "http://localhost:8084";

/**
 * PUBLIC Certificate of Completion proxy (application/pdf). Same
 * no-session posture as the parent verify route — the token is the
 * credential.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string }> },
) {
  const { token } = await ctx.params;
  if (!token || token.length > 128) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const r = await fetch(
    `${SVC}/public/verify/${encodeURIComponent(token)}/certificate`,
    { cache: "no-store" },
  );
  if (!r.ok) {
    const text = await r.text();
    return new NextResponse(text || null, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }
  const buf = await r.arrayBuffer();
  const out = new Headers();
  out.set("content-type", r.headers.get("content-type") ?? "application/pdf");
  const cd = r.headers.get("content-disposition");
  if (cd) out.set("content-disposition", cd);
  out.set("cache-control", "no-store");
  return new NextResponse(buf, { status: 200, headers: out });
}
