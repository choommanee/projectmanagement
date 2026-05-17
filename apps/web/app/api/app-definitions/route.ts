import { NextResponse } from "next/server";
import { mockApps } from "@/lib/mock/apps";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(mockApps.map((a) => ({ id: a.id, name: a.name })));
}
