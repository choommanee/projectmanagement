import { NextResponse } from "next/server";
import { MFG_URL, makeHeaders, proxyPost } from "../_proxy";

export async function GET(req: Request) {
  const h = await makeHeaders();
  if (h instanceof NextResponse) return h;
  const url = new URL(req.url);
  const r = await fetch(`${MFG_URL}/v1/work-orders?${url.searchParams}`, { headers: h });
  return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
}

export async function POST(req: Request) {
  return proxyPost(`${MFG_URL}/v1/work-orders`, req);
}
