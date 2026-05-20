import { MFG_URL, proxyPatch } from "../../../_proxy";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyPatch(`${MFG_URL}/v1/lots/${id}/status`, req);
}
