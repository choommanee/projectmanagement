import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listTasksForProject,
  listAllTasks,
  createTask,
  updateTask,
  deleteTask,
  addDependency,
  removeDependency,
} from "./tasks";

beforeEach(() => {
  global.fetch = vi.fn();
});

const RAW_TASK = {
  ID: "task-001",
  TenantID: "tenant-001",
  ProjectID: "proj-001",
  ParentID: null,
  Code: "T-1",
  Title: "First task",
  Description: "A description",
  Type: "task",
  Status: "todo",
  Priority: "med",
  AssigneeID: null,
  ReviewerID: null,
  EstimateMd: 2.5,
  ActualMd: 0,
  ProgressPct: 0,
  StartDate: null,
  DueDate: "2026-12-31T00:00:00Z",
  SortOrder: 0,
  Tags: ["alpha"],
  CreatedAt: "2026-01-01T00:00:00Z",
  UpdatedAt: "2026-05-01T00:00:00Z",
  Version: 1,
};

describe("tasks API client", () => {
  it("listTasksForProject normalizes Go-style keys", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [RAW_TASK], total: 1 }),
    });

    const { items, total } = await listTasksForProject("proj-001");
    expect(total).toBe(1);
    expect(items[0].id).toBe("task-001");
    expect(items[0].tenantId).toBe("tenant-001");
    expect(items[0].projectId).toBe("proj-001");
    expect(items[0].code).toBe("T-1");
    expect(items[0].estimateMd).toBe(2.5);
    expect(items[0].tags).toEqual(["alpha"]);
    expect(items[0].version).toBe(1);
  });

  it("listTasksForProject handles null items", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: null, total: 0 }),
    });

    const { items, total } = await listTasksForProject("proj-001");
    expect(items).toEqual([]);
    expect(total).toBe(0);
  });

  it("listAllTasks normalizes and calls /api/tasks", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [RAW_TASK], total: 1 }),
    });
    global.fetch = mockFetch;

    const { items, total } = await listAllTasks({ status: "todo" });
    expect(total).toBe(1);
    expect(items[0].id).toBe("task-001");
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/tasks");
    expect(calledUrl).toContain("status=todo");
  });

  it("createTask sends to project-scoped URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => RAW_TASK,
    });
    global.fetch = mockFetch;

    await createTask("proj-001", { code: "T-1", title: "First task", estimate_md: 2.5 });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/projects/proj-001/tasks",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"estimate_md":2.5'),
      }),
    );
  });

  it("createTask throws with backend error message on non-2xx", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: "code already exists" }),
    });

    await expect(
      createTask("proj-001", { code: "DUP-1", title: "Dup" }),
    ).rejects.toThrow("code already exists");
  });

  it("updateTask sends version in body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => RAW_TASK,
    });
    global.fetch = mockFetch;

    await updateTask("task-001", { status: "in_progress", version: 1 });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/tasks/task-001",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"version":1'),
      }),
    );
  });

  it("deleteTask sends version as query param", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = mockFetch;

    await deleteTask("task-001", 2);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/tasks/task-001?version=2",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("addDependency sends to /api/tasks/:id/dependencies", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ID: "dep-001",
        PredecessorID: "task-000",
        SuccessorID: "task-001",
        Type: "fs",
        LagDays: 0,
      }),
    });
    global.fetch = mockFetch;

    const dep = await addDependency("task-001", { predecessor_id: "task-000", type: "fs" });
    expect(dep.id).toBe("dep-001");
    expect(dep.predecessorId).toBe("task-000");
    expect(dep.type).toBe("fs");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/tasks/task-001/dependencies",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("removeDependency sends DELETE to /api/dependencies/:id", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = mockFetch;

    await removeDependency("dep-001");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/dependencies/dep-001",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
