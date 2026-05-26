import { MFG_URL, proxyPost } from "../../../_proxy";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyPost(`${MFG_URL}/v1/purchase-orders/${id}/receive`, req);
}
