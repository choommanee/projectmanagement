import { MFG_URL, proxyGet, proxyPatch, proxyDelete } from "../../_proxy";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyGet(`${MFG_URL}/v1/work-centers/${id}`);
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyPatch(`${MFG_URL}/v1/work-centers/${id}`, req);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return proxyDelete(`${MFG_URL}/v1/work-centers/${id}`, req);
}
