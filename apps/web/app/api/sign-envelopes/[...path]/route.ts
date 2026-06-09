import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";
import { forwardClientContext } from "@/lib/auth/forwardIp";

const SVC = process.env.DOCUMENT_URL ?? "http://localhost:8084";

/**
 * Catch-all proxy for envelope-scoped Tier-1 e-signature endpoints:
 *   /api/sign-envelopes/{id}
 *   /api/sign-envelopes/{id}/send
 *   /api/sign-envelopes/{id}/signers/{signerId}/view|sign|decline
 *   /api/sign-envelopes/{id}/void
 *   /api/sign-envelopes/{id}/verify
 *   /api/sign-envelopes/{id}/audit
 *   /api/sign-envelopes/{id}/certificate  → application/pdf (binary, not JSON)
 *
 * Forwards tenant + JWT (with auto-refresh) via proxyHeaders() and the
 * originating client IP / User-Agent via forwardClientContext() so the backend
 * can record the signer's IP in the sign audit trail.
 */
function methodHandler(method: string) {
  return async function (req: Request, ctx: { params: Promise<{ path: string[] }> }) {
    const h = await proxyHeaders();
    if (!(h instanceof Headers)) {
      return NextResponse.json({ error: h.error }, { status: h.status });
    }
    forwardClientContext(req, h);

    const { path } = await ctx.params;
    const url = new URL(req.url);
    const target = `${SVC}/v1/sign-envelopes/${path.join("/")}${url.search}`;

    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
      body = await req.text();
      if (body) h.set("content-type", "application/json");
    }

    const r = await fetch(target, { method, headers: h, body });

    // Binary passthrough (certificate PDF) — do NOT JSON-parse.
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
      const buf = await r.arrayBuffer();
      const out = new Headers();
      out.set("content-type", ct);
      const cd = r.headers.get("content-disposition");
      if (cd) out.set("content-disposition", cd);
      return new NextResponse(buf, { status: r.status, headers: out });
    }

    const text = r.status === 204 ? "" : await r.text();
    return new NextResponse(text || null, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  };
}

export const GET = methodHandler("GET");
export const POST = methodHandler("POST");
export const PATCH = methodHandler("PATCH");
export const DELETE = methodHandler("DELETE");
