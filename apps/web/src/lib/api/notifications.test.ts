import { describe, it, expect, vi, beforeEach } from "vitest";
import { listNotifications, markRead, markAllRead } from "./notifications";

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); });

describe("listNotifications", () => {
  it("returns normalised items", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ id: "n1", kind: "mfg.work_order.released", title: "WO released",
                   body: "", payload: {}, read_at: null, created_at: "2026-01-01T00:00:00Z",
                   tenant_id: "t1", user_id: "u1" }],
        total: 1,
      }),
    });
    const { items, total } = await listNotifications();
    expect(total).toBe(1);
    expect(items[0].kind).toBe("mfg.work_order.released");
    expect(items[0].readAt).toBeNull();
  });

  it("throws on non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(listNotifications()).rejects.toThrow("list failed: 401");
  });
});

describe("markRead", () => {
  it("calls POST /:id/read", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    await markRead("n1");
    expect(fetchMock).toHaveBeenCalledWith("/api/notifications/n1/read", { method: "POST" });
  });
});

describe("markAllRead", () => {
  it("calls POST /read-all", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true });
    await markAllRead();
    expect(fetchMock).toHaveBeenCalledWith("/api/notifications/read-all", { method: "POST" });
  });
});
