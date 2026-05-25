import { MFG_URL, proxyGet, proxyPost } from "../_proxy";

export async function GET(req: Request) {
  return proxyGet(`${MFG_URL}/v1/inventory`);
}

export async function POST(req: Request) {
  return proxyPost(`${MFG_URL}/v1/inventory/transactions`, req);
}
