import { MFG_URL, proxyGet, proxyPost } from "../_proxy";

export async function GET() {
  return proxyGet(`${MFG_URL}/v1/work-centers`);
}

export async function POST(req: Request) {
  return proxyPost(`${MFG_URL}/v1/work-centers`, req);
}
