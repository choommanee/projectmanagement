import { MFG_URL, proxyGet, proxyPost } from "../../../_proxy";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyGet(`${MFG_URL}/v1/lots/${id}/genealogy`);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyPost(`${MFG_URL}/v1/lots/${id}/genealogy`, req);
}
