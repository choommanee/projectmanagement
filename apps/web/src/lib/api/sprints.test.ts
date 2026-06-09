import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listSprintsForProject,
  getSprint,
  createSprint,
  updateSprint,
  assignTaskToSprint,
  unassignTaskFromSprint,
  listSprintTasks,
  deleteSprint,
  normSprint,
} from "./sprints";

beforeEach(() => {
  global.fetch = vi.fn();
});

const RAW_SPRINT = {
  id: "sprint-001",
  tenant_id: "tenant-001",
  project_id: "proj-001",
  name: "Sprint 1",
  goal: "Ship MVP",
  status: "planning",
  start_date: "2026-06-01T00:00:00Z",
  end_date: "2026-06-14T00:00:00Z",
  capacity_pts: 40,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  version: 1,
};

const RAW_TASK = {
  id: "task-001",
  tenant_id: "tenant-001",
  project_id: "proj-001",
  parent_id: null,
  code: "T-1",
  title: "Sprint task",
  description: "",
  type: "task",
  status: "todo",
  priority: "med",
  assignee_id: null,
  reviewer_id: null,
  estimate_md: 2,
  actual_md: 0,
  progress_pct: 0,
  start_date: null,
  due_date: null,
  sort_order: 0,
  tags: [],
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  version: 1,
};

describe("sprints API client", () => {
  it("normSprint maps snake_case keys", () => {
    const sp = normSprint(RAW_SPRINT as Record<string, unknown>);
    expect(sp.id).toBe("sprint-001");
    expect(sp.tenantId).toBe("tenant-001");
    expect(sp.projectId).toBe("proj-001");
    expect(sp.name).toBe("Sprint 1");
    expect(sp.goal).toBe("Ship MVP");
    expect(sp.status).toBe("planning");
    expect(sp.capacityPts).toBe(40);
    expect(sp.version).toBe(1);
  });

  it("listSprintsForProject normalizes array form", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => [RAW_SPRINT],
    });

    const items = await listSprintsForProject("proj-001");
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("sprint-001");
    expect(items[0].name).toBe("Sprint 1");
  });

  it("listSprintsForProject normalizes items-envelope form", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [RAW_SPRINT], total: 1 }),
    });

    const items = await listSprintsForProject("proj-001");
    expect(items).toHaveLength(1);
    expect(items[0].capacityPts).toBe(40);
  });

  it("getSprint fetches /api/sprints/:id and normalizes", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => RAW_SPRINT,
    });
    global.fetch = mockFetch;

    const sp = await getSprint("sprint-001");
    expect(sp.id).toBe("sprint-001");
    expect(sp.goal).toBe("Ship MVP");
    expect(mockFetch.mock.calls[0][0]).toBe("/api/sprints/sprint-001");
  });

  it("createSprint sends POST with body and returns normalized sprint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => RAW_SPRINT,
    });
    global.fetch = mockFetch;

    const sp = await createSprint("proj-001", {
      name: "Sprint 1",
      goal: "Ship MVP",
      start_date: "2026-06-01",
      end_date: "2026-06-14",
      capacity_pts: 40,
    });

    expect(sp.id).toBe("sprint-001");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/projects/proj-001/sprints",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"name":"Sprint 1"'),
      }),
    );
    const body = String((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toContain('"start_date":"2026-06-01"');
    expect(body).toContain('"end_date":"2026-06-14"');
  });

  it("updateSprint sends PATCH with version in body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...RAW_SPRINT, status: "active", version: 2 }),
    });
    global.fetch = mockFetch;

    const sp = await updateSprint("sprint-001", { status: "active", version: 1 });

    expect(sp.status).toBe("active");
    expect(sp.version).toBe(2);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/sprints/sprint-001",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"version":1'),
      }),
    );
  });

  it("assignTaskToSprint POSTs to correct URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = mockFetch;

    await assignTaskToSprint("sprint-001", "task-001");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/sprints/sprint-001/tasks/task-001",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("unassignTaskFromSprint DELETEs correct URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = mockFetch;

    await unassignTaskFromSprint("sprint-001", "task-001");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/sprints/sprint-001/tasks/task-001",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("listSprintTasks normalizes tasks via normTask", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [RAW_TASK], total: 1 }),
    });

    const tasks = await listSprintTasks("sprint-001");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("task-001");
    expect(tasks[0].code).toBe("T-1");
    expect(tasks[0].estimateMd).toBe(2);
    expect(tasks[0].status).toBe("todo");
  });

  it("deleteSprint sends version as query param", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = mockFetch;

    await deleteSprint("sprint-001", 3);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/sprints/sprint-001?version=3",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("deleteSprint surfaces 409 conflict message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "version conflict" }) });
    global.fetch = mockFetch;
    await expect(deleteSprint("sprint-001", 1)).rejects.toThrow("version conflict");
  });
});
