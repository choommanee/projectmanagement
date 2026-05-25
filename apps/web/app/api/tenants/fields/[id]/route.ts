import { NextResponse } from "next/server";
import { proxyHeaders } from "@/lib/auth/serverTenant";

const SVC = process.env.TENANT_URL ?? "http://localhost:8081";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const h = await proxyHeaders();
  if (!(h instanceof Headers)) {
    return NextResponse.json({ error: h.error }, { status: h.status });
  }
  const r = await fetch(`${SVC}/v1/custom-fields/${id}`, {
    method: "DELETE",
    headers: h,
  });
  return new NextResponse(null, { status: r.status });
}
