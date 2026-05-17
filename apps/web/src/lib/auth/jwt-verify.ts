import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS_URL =
  process.env.IDENTITY_JWKS_URL ??
  "http://localhost:8082/.well-known/jwks.json";

export interface Claims {
  sub: string;
  tid: string;
  roles: string[];
  exp: number;
}

type JWKSCache = {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  fetchedAt: number;
};

let cache: JWKSCache | null = null;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getJWKS() {
  const now = Date.now();
  if (!cache || now - cache.fetchedAt > CACHE_TTL_MS) {
    cache = {
      jwks: createRemoteJWKSet(new URL(JWKS_URL)),
      fetchedAt: now,
    };
  }
  return cache.jwks;
}

/**
 * Verify an access token using the identity-svc JWKS.
 * Returns parsed claims or null if invalid/expired.
 */
export async function verifyAccessToken(token: string): Promise<Claims | null> {
  try {
    const jwks = getJWKS();
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"],
    });

    const tid =
      typeof payload["tid"] === "string" ? payload["tid"] : "";
    const rolesRaw = payload["roles"];
    const roles: string[] = Array.isArray(rolesRaw)
      ? (rolesRaw as string[]).filter((r) => typeof r === "string")
      : [];

    return {
      sub: payload.sub ?? "",
      tid,
      roles,
      exp: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}
