import { MFG_URL, proxyGet } from "../../_proxy";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const { itemId } = await params;
  return proxyGet(`${MFG_URL}/v1/inventory/items/${itemId}/balance`);
}
