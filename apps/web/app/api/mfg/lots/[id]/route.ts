import { MFG_URL, proxyGet, proxyPatch, proxyDelete } from "../../_proxy";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyGet(`${MFG_URL}/v1/lots/${id}`);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyPatch(`${MFG_URL}/v1/lots/${id}`, req);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyDelete(`${MFG_URL}/v1/lots/${id}`, req);
}
