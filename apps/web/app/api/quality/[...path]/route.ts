import { NextResponse } from "next/server";
import { currentTenantId, currentAccessToken } from "@/lib/auth/serverTenant";

const SVC = process.env.QUALITY_URL ?? "http://localhost:8087";

function methodHandler(method: string) {
  return async function (req: Request, ctx: { params: Promise<{ path: string[] }> }) {
    const tid = await currentTenantId();
    if (!tid) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
    const at = await currentAccessToken();
    const { path } = await ctx.params;
    const url = new URL(req.url);
    const target = `${SVC}/v1/${path.join("/")}${url.search}`;
    const headers: Record<string, string> = { "X-Tenant-Id": tid };
    if (at) headers["Authorization"] = `Bearer ${at}`;
    let body: string | undefined;
    if (method !== "GET" && method !== "HEAD" && method !== "DELETE") {
      body = await req.text();
      if (body) headers["content-type"] = "application/json";
    }
    const r = await fetch(target, { method, headers, body });
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
