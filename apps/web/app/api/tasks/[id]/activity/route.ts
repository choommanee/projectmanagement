import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.PROJECT_URL ?? "http://localhost:8083";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await proxyHeaders();
  if (h instanceof Headers) {
    const r = await fetch(`${SVC}/v1/tasks/${id}/activity`, { headers: h });
    return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
  }
  return NextResponse.json({ error: h.error }, { status: h.status });
}
