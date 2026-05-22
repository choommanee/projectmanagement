import { NextRequest, NextResponse } from "next/server";

const SUPPORTED_LOCALES = ["en", "th"] as const;
const LOCALE_COOKIE = "NEXT_LOCALE";
const AUTH_PROTECTED = /^\/(pm|mfg)(\/|$)/;

function stripLocalePrefix(pathname: string): { locale: string | null; rest: string } {
  for (const lc of SUPPORTED_LOCALES) {
    if (pathname === `/${lc}`) return { locale: lc, rest: "/" };
    if (pathname.startsWith(`/${lc}/`)) return { locale: lc, rest: pathname.slice(lc.length + 1) };
  }
  return { locale: null, rest: pathname };
}

export const config = {
  // Match every route except Next internals, static assets, and api/_vercel.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|api/|.*\\..*).*)",
  ],
};

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const { locale: pathLocale, rest } = stripLocalePrefix(url.pathname);

  // Effective path after potential locale strip — used for auth checks.
  const effectivePath = pathLocale ? rest : url.pathname;
  const needsAuth = AUTH_PROTECTED.test(effectivePath);

  // Auth gate (matches previous /(pm|mfg)/ behavior, now locale-aware).
  if (needsAuth) {
    const demoCookie = req.cookies.get("demo")?.value;
    const accessToken = req.cookies.get("access_token")?.value;
    if (demoCookie !== "1" && !accessToken) {
      const loginUrl = url.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      const nextParam = effectivePath + (url.searchParams.toString() ? `?${url.searchParams.toString()}` : "");
      loginUrl.searchParams.set("next", nextParam);
      return NextResponse.redirect(loginUrl);
    }
  }

  // If URL has a locale prefix, rewrite to strip it and persist the locale cookie.
  if (pathLocale) {
    const rewriteUrl = url.clone();
    rewriteUrl.pathname = rest;
    const res = NextResponse.rewrite(rewriteUrl);
    res.cookies.set(LOCALE_COOKIE, pathLocale, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
    return res;
  }

  return NextResponse.next();
}
