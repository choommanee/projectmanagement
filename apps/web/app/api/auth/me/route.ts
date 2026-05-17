import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, USER_COOKIE, decodeUserMeta } from "@/lib/auth/cookies";
import { verifyAccessToken } from "@/lib/auth/jwt-verify";

export async function GET(_req: NextRequest) {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }

  const claims = await verifyAccessToken(token);
  if (!claims) {
    return NextResponse.json({ error: "invalid or expired token" }, { status: 401 });
  }

  // Return enriched user data from user_meta cookie if available
  const rawMeta = store.get(USER_COOKIE)?.value;
  if (rawMeta) {
    const meta = decodeUserMeta(rawMeta);
    if (meta) {
      return NextResponse.json(meta);
    }
  }

  // Fall back to JWT claims
  return NextResponse.json({
    id: claims.sub,
    email: "",
    displayName: claims.sub,
    tenantId: claims.tid,
    tenantSlug: "",
  });
}
