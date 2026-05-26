import { MFG_URL, proxyPatch, proxyDelete } from "../../../../_proxy";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await ctx.params;
  return proxyPatch(`${MFG_URL}/v1/purchase-orders/${id}/lines/${lineId}`, req);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; lineId: string }> }) {
  const { id, lineId } = await ctx.params;
  return proxyDelete(`${MFG_URL}/v1/purchase-orders/${id}/lines/${lineId}`, req);
}
