import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "./cookies";
import { verifyAccessToken } from "./jwt-verify";
import type { UserMeta } from "./cookies";

/**
 * RSC helper: reads and verifies the access_token cookie, returns user info or null.
 */
export async function currentUser(): Promise<UserMeta | null> {
  const store = await cookies();
  const token = store.get(ACCESS_COOKIE)?.value;
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  // Derive displayName from email local part (Phase 1 — backend doesn't yet
  // embed display_name in the JWT claims)
  const userMetaCookie = store.get("user_meta")?.value;
  if (userMetaCookie) {
    try {
      const { decodeUserMeta } = await import("./cookies");
      const meta = decodeUserMeta(userMetaCookie);
      if (meta) return meta;
    } catch {
      // fall through to claims-derived data
    }
  }

  return {
    id: claims.sub,
    email: "",
    displayName: claims.sub,
    tenantId: claims.tid,
    tenantSlug: "",
  };
}
