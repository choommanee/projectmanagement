import { MFG_URL, proxyPost } from "../_proxy";

export async function POST(req: Request) {
  return proxyPost(`${MFG_URL}/v1/lots`, req);
}
