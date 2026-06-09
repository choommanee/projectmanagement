/**
 * Forward the originating client IP to the backend so the signing audit trail
 * can capture the signer's IP address (important for the legal validity of an
 * e-signature). The browser request that hit this Next.js proxy carries the
 * real client address in standard proxy headers; we copy those onto the
 * outbound (server→backend) request headers.
 *
 * Backends read `X-Forwarded-For` (RFC-style, comma-separated, client first).
 * We also forward the original User-Agent so the device fingerprint in the
 * audit event reflects the signer's browser, not the Next.js server runtime.
 */
export function forwardClientContext(req: Request, out: Headers): void {
  const xff =
    req.headers.get("x-forwarded-for") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("cf-connecting-ip");
  if (xff) out.set("X-Forwarded-For", xff);

  const realIp = req.headers.get("x-real-ip");
  if (realIp) out.set("X-Real-Ip", realIp);

  const ua = req.headers.get("user-agent");
  if (ua) out.set("User-Agent", ua);
}
