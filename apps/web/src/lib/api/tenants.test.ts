import { describe, it, expect, vi, beforeEach } from "vitest";
import { listTenants, createTenant, updateTenant, deleteTenant } from "./tenants";

beforeEach(() => {
  global.fetch = vi.fn();
});

describe("tenants API client", () => {
  it("listTenants normalizes Go-style keys", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ ID: "1", Slug: "a", Name: "A", Tier: "shared", Status: "active", Region: "ap-1", Version: 1 }],
        total: 1,
      }),
    });
    const { items, total } = await listTenants("");
    expect(total).toBe(1);
    expect(items[0].id).toBe("1");
    expect(items[0].slug).toBe("a");
  });

  it("createTenant posts and normalizes response", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ID: "2", Slug: "b", Name: "B", Tier: "shared", Status: "active", Region: "ap-1", Version: 1 }),
    });
    const t = await createTenant({ slug: "b", name: "B" });
    expect(t.slug).toBe("b");
  });

  it("updateTenant throws on non-200", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "version conflict" }),
    });
    await expect(updateTenant("1", { name: "x", version: 1 })).rejects.toThrow(/conflict/);
  });

  it("deleteTenant sends version query", async () => {
    const mock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    global.fetch = mock;
    await deleteTenant("1", 3);
    expect(mock).toHaveBeenCalledWith("/api/tenants/1?version=3", { method: "DELETE" });
  });
});
