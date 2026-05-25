import { MFG_URL, proxyGet } from "../../../_proxy";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  return proxyGet(`${MFG_URL}/v1/lots/${id}/trace?${url.searchParams.toString()}`);
}
