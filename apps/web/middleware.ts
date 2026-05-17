import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: [
    "/(pm|mfg)/:path*",
  ],
};

export function middleware(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;

  // Demo mode bypass
  const demoCookie = req.cookies.get("demo")?.value;
  if (demoCookie === "1") {
    return NextResponse.next();
  }

  // Check access_token cookie
  const accessToken = req.cookies.get("access_token")?.value;
  if (accessToken) {
    return NextResponse.next();
  }

  // Redirect to login with next= parameter
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  loginUrl.searchParams.set("next", pathname + (searchParams.toString() ? `?${searchParams.toString()}` : ""));
  return NextResponse.redirect(loginUrl);
}
