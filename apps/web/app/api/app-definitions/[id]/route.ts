import { NextResponse } from "next/server";
import { mockApps } from "@/lib/mock/apps";

export const dynamic = "force-static";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const app = mockApps.find((a) => a.id === id);
  if (!app) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(app);
}
