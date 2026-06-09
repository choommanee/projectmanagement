import { MFG_URL, proxyGet, proxyPost } from "../../../_proxy";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGet(`${MFG_URL}/v1/routings/${id}/operations`);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyPost(`${MFG_URL}/v1/routings/${id}/operations`, req);
}
