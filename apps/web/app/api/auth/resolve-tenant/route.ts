import { NextRequest, NextResponse } from "next/server";

const TENANT_URL = process.env.TENANT_URL ?? "http://localhost:8081";

export async function GET(req: NextRequest) {
  const slugParam = req.nextUrl.searchParams.get("slug");
  if (!slugParam) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(
      `${TENANT_URL}/v1/tenants/by-slug/${encodeURIComponent(slugParam)}`,
    );
  } catch {
    return NextResponse.json(
      { error: "Cannot reach tenant service" },
      { status: 503 },
    );
  }

  if (res.status === 404) {
    return NextResponse.json(
      { error: `Tenant '${slugParam}' not found` },
      { status: 404 },
    );
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: "Tenant service error" },
      { status: 502 },
    );
  }

  const tenant = await res.json() as Record<string, unknown>;
  // tenant-svc returns uppercase Go struct keys (ID, Slug) — normalize to lowercase
  const normalizedId = (tenant.id ?? tenant.ID) as string;
  const normalizedSlug = (tenant.slug ?? tenant.Slug) as string;
  return NextResponse.json({ ...tenant, id: normalizedId, slug: normalizedSlug });
}
