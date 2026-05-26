import { NextResponse } from "next/server";
import { MFG_URL, makeHeaders } from "../../../_proxy";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const r = await fetch(`${MFG_URL}/v1/rfqs/${id}/send`, { method: "POST", headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}
