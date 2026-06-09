import { describe, it, expect, vi, beforeEach } from "vitest";
import { listProjects, createProject, updateProject, deleteProject } from "./projects";

beforeEach(() => {
  global.fetch = vi.fn();
});

describe("projects API client", () => {
  it("listProjects maps snake_case payload and handles empty items array", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "abc-123",
            tenant_id: "t-001",
            code: "PRJ-1",
            name: "Test Project",
            description: "A test",
            status: "active",
            owner_id: null,
            start_date: null,
            due_date: "2026-12-31",
            progress_pct: 42,
            tags: ["alpha"],
            settings: { color: "blue" },
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-05-01T00:00:00Z",
            version: 3,
          },
        ],
        total: 1,
      }),
    });

    const { items, total } = await listProjects();
    expect(total).toBe(1);
    expect(items[0].id).toBe("abc-123");
    expect(items[0].tenantId).toBe("t-001");
    expect(items[0].code).toBe("PRJ-1");
    expect(items[0].dueDate).toBe("2026-12-31");
    expect(items[0].progressPct).toBe(42);
    expect(items[0].tags).toEqual(["alpha"]);
    expect(items[0].settings).toEqual({ color: "blue" });
    expect(items[0].version).toBe(3);
  });

  it("listProjects handles null/empty items array", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: null, total: 0 }),
    });

    const { items, total } = await listProjects();
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });

  it("createProject throws with backend error message on non-2xx", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: "code already exists" }),
    });

    await expect(
      createProject({ code: "DUP-1", name: "Duplicate" }),
    ).rejects.toThrow("code already exists");
  });

  it("updateProject sends version in body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "p-1",
        tenant_id: "t-1",
        code: "PRJ-1",
        name: "Updated",
        description: "",
        status: "active",
        progress_pct: 0,
        tags: [],
        settings: {},
        created_at: "",
        updated_at: "",
        version: 2,
      }),
    });
    global.fetch = mockFetch;

    await updateProject("p-1", {
      name: "Updated",
      owner_id: "user-001",
      start_date: "2026-06-01",
      due_date: "2026-06-20",
      version: 1,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/projects/p-1",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"version":1'),
      }),
    );
    const body = String((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toContain('"owner_id":"user-001"');
    expect(body).toContain('"start_date":"2026-06-01"');
    expect(body).toContain('"due_date":"2026-06-20"');
  });

  it("updateProject serializes empty description and null dates as explicit clears", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "p-1",
        tenant_id: "t-1",
        code: "PRJ-1",
        name: "Updated",
        description: "",
        status: "active",
        start_date: "2026-06-02",
        due_date: null,
        progress_pct: 0,
        tags: [],
        settings: {},
        created_at: "",
        updated_at: "",
        version: 3,
      }),
    });
    global.fetch = mockFetch;

    const p = await updateProject("p-1", {
      name: "Updated",
      description: "",
      start_date: "2026-06-02",
      due_date: null,
      version: 2,
    });

    // "" and null must survive JSON.stringify — they are the clear signals
    // the backend's *string / optDate decoding relies on.
    const body = String((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toContain('"description":""');
    expect(body).toContain('"due_date":null');
    expect(body).toContain('"start_date":"2026-06-02"');
    expect(p.description).toBe("");
    expect(p.dueDate).toBeNull();
    expect(p.startDate).toBe("2026-06-02");
  });

  it("deleteProject sends version as query param", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = mockFetch;

    await deleteProject("p-2", 5);

    expect(mockFetch).toHaveBeenCalledWith("/api/projects/p-2?version=5", {
      method: "DELETE",
      headers: { "X-Confirm-Destructive": "true" },
    });
  });
});
