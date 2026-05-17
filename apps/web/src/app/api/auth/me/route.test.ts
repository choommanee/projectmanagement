import { describe, it, expect, vi, beforeEach } from "vitest";
import { encodeUserMeta } from "@/lib/auth/cookies";
import type { UserMeta } from "@/lib/auth/cookies";

// --- mock next/headers ---
const mockCookieStore = {
  get: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mockCookieStore),
}));

// --- mock jwt-verify ---
vi.mock("@/lib/auth/jwt-verify", () => ({
  verifyAccessToken: vi.fn(),
}));

// Import AFTER mocks are set up
const { GET } = await import(
  "../../../../../app/api/auth/me/route"
);
const { verifyAccessToken } = await import("@/lib/auth/jwt-verify");

const mockVerify = verifyAccessToken as ReturnType<typeof vi.fn>;

const sampleUser: UserMeta = {
  id: "user-1",
  email: "alice@example.com",
  displayName: "Alice",
  tenantId: "tid-1",
  tenantSlug: "alice-co",
};

function makeCookieStore(
  accessToken?: string,
  userMeta?: UserMeta,
) {
  return {
    get: vi.fn((name: string) => {
      if (name === "access_token" && accessToken)
        return { value: accessToken };
      if (name === "user_meta" && userMeta)
        return { value: encodeUserMeta(userMeta) };
      return undefined;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/auth/me", () => {
  it("returns 401 when no access_token cookie", async () => {
    mockCookieStore.get = vi.fn(() => undefined);

    const req = new Request("http://localhost/api/auth/me");
    const res = await GET(req as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/not authenticated/i);
  });

  it("returns 401 when token is invalid", async () => {
    mockCookieStore.get = vi.fn((name: string) =>
      name === "access_token" ? { value: "bad-token" } : undefined,
    );
    mockVerify.mockResolvedValue(null);

    const req = new Request("http://localhost/api/auth/me");
    const res = await GET(req as never);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid|expired/i);
  });

  it("returns user metadata when token is valid and user_meta cookie present", async () => {
    const store = makeCookieStore("valid-token", sampleUser);
    mockCookieStore.get = store.get;
    mockVerify.mockResolvedValue({
      sub: sampleUser.id,
      tid: sampleUser.tenantId,
      roles: [],
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    const req = new Request("http://localhost/api/auth/me");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("alice@example.com");
    expect(body.displayName).toBe("Alice");
    expect(body.tenantSlug).toBe("alice-co");
  });

  it("falls back to JWT claims when user_meta cookie is missing", async () => {
    mockCookieStore.get = vi.fn((name: string) =>
      name === "access_token" ? { value: "valid-token" } : undefined,
    );
    mockVerify.mockResolvedValue({
      sub: "user-fallback",
      tid: "tid-fallback",
      roles: [],
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    const req = new Request("http://localhost/api/auth/me");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("user-fallback");
    expect(body.tenantId).toBe("tid-fallback");
  });
});
