import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listSprintsForProject,
  getSprint,
  createSprint,
  updateSprint,
  assignTaskToSprint,
  unassignTaskFromSprint,
  listSprintTasks,
  normSprint,
} from "./sprints";

beforeEach(() => {
  global.fetch = vi.fn();
});

const RAW_SPRINT = {
  ID: "sprint-001",
  TenantID: "tenant-001",
  ProjectID: "proj-001",
  Name: "Sprint 1",
  Goal: "Ship MVP",
  Status: "planning",
  StartDate: "2026-06-01T00:00:00Z",
  EndDate: "2026-06-14T00:00:00Z",
  CapacityPts: 40,
  CreatedAt: "2026-05-01T00:00:00Z",
  UpdatedAt: "2026-05-01T00:00:00Z",
  Version: 1,
};

const RAW_TASK = {
  ID: "task-001",
  TenantID: "tenant-001",
  ProjectID: "proj-001",
  ParentID: null,
  Code: "T-1",
  Title: "Sprint task",
  Description: "",
  Type: "task",
  Status: "todo",
  Priority: "med",
  AssigneeID: null,
  ReviewerID: null,
  EstimateMd: 2,
  ActualMd: 0,
  ProgressPct: 0,
  StartDate: null,
  DueDate: null,
  SortOrder: 0,
  Tags: [],
  CreatedAt: "2026-05-01T00:00:00Z",
  UpdatedAt: "2026-05-01T00:00:00Z",
  Version: 1,
};

describe("sprints API client", () => {
  it("normSprint handles Go PascalCase keys", () => {
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
  });

  it("updateSprint sends PATCH with version in body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...RAW_SPRINT, Status: "active", Version: 2 }),
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
});
