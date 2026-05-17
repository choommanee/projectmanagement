import { NextResponse } from "next/server";
import { USER_COOKIE, DEMO_COOKIE, encodeUserMeta } from "@/lib/auth/cookies";
import type { UserMeta } from "@/lib/auth/cookies";

const DEMO_USER: UserMeta = {
  id: "demo",
  email: "demo@demo.co",
  displayName: "Demo User",
  tenantId: "",
  tenantSlug: "demo-co",
};

export async function POST() {
  const response = NextResponse.json({ ok: true });

  const base = {
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 24 * 60 * 60,
  };

  response.cookies.set(DEMO_COOKIE, "1", { ...base, httpOnly: true });
  response.cookies.set(USER_COOKIE, encodeUserMeta(DEMO_USER), {
    ...base,
    httpOnly: false,
  });

  return response;
}
