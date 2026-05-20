import { MFG_URL, proxyPatch, proxyDelete } from "../../_proxy";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyPatch(`${MFG_URL}/v1/bom-lines/${id}`, req);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyDelete(`${MFG_URL}/v1/bom-lines/${id}`, req);
}
