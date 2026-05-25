import { MFG_URL, proxyPost } from "../../../_proxy";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyPost(`${MFG_URL}/v1/lots/${id}/genealogy`, req);
}
