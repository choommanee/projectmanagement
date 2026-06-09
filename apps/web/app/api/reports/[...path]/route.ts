import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.REPORTS_URL ?? "http://localhost:8092";

function methodHandler(method: string) {
  return async function (req: Request, ctx: { params: Promise<{ path: string[] }> }) {
    const h = await proxyHeaders();
    if (!(h instanceof Headers)) return NextResponse.json({ error: h.error }, { status: h.status });
    const { path } = await ctx.params;
    const url = new URL(req.url);
    const target = `${SVC}/v1/${path.join("/")}${url.search}`;
    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
      body = await req.text();
      if (body) h.set("content-type", "application/json");
    }
    const r = await fetch(target, { method, headers: h, body });
    const text = r.status === 204 ? "" : await r.text();
    return new NextResponse(text || null, {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  };
}

export const GET    = methodHandler("GET");
export const POST   = methodHandler("POST");
export const PATCH  = methodHandler("PATCH");
export const DELETE = methodHandler("DELETE");
