import { NextResponse } from "next/server";
import { MFG_URL, makeHeaders } from "../../../../_proxy";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const url = new URL(req.url);
  const qty = url.searchParams.get("qty") ?? "1";
  const r = await fetch(`${MFG_URL}/v1/items/${id}/bom/explode?qty=${qty}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
