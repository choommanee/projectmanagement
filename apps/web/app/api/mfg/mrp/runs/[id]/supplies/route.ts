import { MFG_URL, proxyGet } from "../../../../_proxy";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGet(`${MFG_URL}/v1/mrp/runs/${id}/supplies`);
}
