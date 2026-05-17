import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
export const USER_COOKIE = "user_meta";
export const DEMO_COOKIE = "demo";

export interface UserMeta {
  id: string;
  email: string;
  displayName: string;
  tenantId: string;
  tenantSlug: string;
}

const COOKIE_MAX_AGE_ACCESS = 15 * 60; // 15 minutes
const COOKIE_MAX_AGE_REFRESH = 30 * 24 * 60 * 60; // 30 days

/**
 * Encode UserMeta as base64 JSON for the user_meta cookie.
 */
export function encodeUserMeta(user: UserMeta): string {
  return Buffer.from(JSON.stringify(user)).toString("base64");
}

/**
 * Decode UserMeta from base64 JSON cookie value. Returns null on failure.
 */
export function decodeUserMeta(raw: string): UserMeta | null {
  try {
    const json = Buffer.from(raw, "base64").toString("utf-8");
    const parsed = JSON.parse(json);
    if (
      typeof parsed.id === "string" &&
      typeof parsed.email === "string" &&
      typeof parsed.displayName === "string"
    ) {
      return parsed as UserMeta;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Set httpOnly auth cookies on a NextResponse (or any object with a cookies property).
 * The user_meta cookie is NOT httpOnly so client JS can read it for display.
 */
export function setAuthCookies(
  response: { cookies: { set: (name: string, value: string, opts: Record<string, unknown>) => void } },
  tokens: { access_token: string; refresh_token: string },
  user: UserMeta,
) {
  const base = {
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };

  response.cookies.set(ACCESS_COOKIE, tokens.access_token, {
    ...base,
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE_ACCESS,
  });

  response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, {
    ...base,
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE_REFRESH,
  });

  response.cookies.set(USER_COOKIE, encodeUserMeta(user), {
    ...base,
    httpOnly: false,
    maxAge: COOKIE_MAX_AGE_REFRESH,
  });
}

/**
 * Clear all auth cookies.
 */
export function clearAuthCookies(response: {
  cookies: { set: (name: string, value: string, opts: Record<string, unknown>) => void };
}) {
  const base = { path: "/", maxAge: 0 };
  response.cookies.set(ACCESS_COOKIE, "", base);
  response.cookies.set(REFRESH_COOKIE, "", base);
  response.cookies.set(USER_COOKIE, "", base);
  response.cookies.set(DEMO_COOKIE, "", base);
}

/**
 * Read the user_meta cookie in a RSC context (using next/headers cookies()).
 */
export async function readUserCookie(
  cookieStore?: ReadonlyRequestCookies,
): Promise<UserMeta | null> {
  let store = cookieStore;
  if (!store) {
    const { cookies } = await import("next/headers");
    store = await cookies();
  }
  const raw = store.get(USER_COOKIE)?.value;
  if (!raw) return null;
  return decodeUserMeta(raw);
}
