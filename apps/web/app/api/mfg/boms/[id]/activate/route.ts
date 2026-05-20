import { NextResponse } from "next/server";
import { MFG_URL, makeHeaders } from "../../../_proxy";

export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${MFG_URL}/v1/boms/${id}/activate`, { method: "POST", headers: h });
  return new NextResponse(r.status === 204 ? null : await r.text(), { status: r.status });
}
