import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, DEMO_COOKIE } from "@/lib/auth/cookies";

export default async function Home() {
  const jar = await cookies();
  const authed =
    jar.get(ACCESS_COOKIE)?.value || jar.get(DEMO_COOKIE)?.value === "1";
  redirect(authed ? "/pm/home" : "/login");
}
