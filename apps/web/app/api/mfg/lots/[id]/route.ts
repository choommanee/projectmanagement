import { MFG_URL, proxyDelete } from "../../_proxy";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyDelete(`${MFG_URL}/v1/lots/${id}`, req);
}
