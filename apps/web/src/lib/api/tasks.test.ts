import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listTasksForProject,
  listAllTasks,
  createTask,
  updateTask,
  deleteTask,
  addDependency,
  removeDependency,
  listComments,
  createComment,
  updateComment,
  deleteComment,
} from "./tasks";

beforeEach(() => {
  global.fetch = vi.fn();
});

const RAW_TASK = {
  id: "task-001",
  tenant_id: "tenant-001",
  project_id: "proj-001",
  parent_id: null,
  code: "T-1",
  title: "First task",
  description: "A description",
  type: "task",
  status: "todo",
  priority: "med",
  assignee_id: null,
  reviewer_id: null,
  estimate_md: 2.5,
  actual_md: 0,
  progress_pct: 0,
  start_date: null,
  due_date: "2026-12-31T00:00:00Z",
  sort_order: 0,
  tags: ["alpha"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
  version: 1,
};

describe("tasks API client", () => {
  it("listTasksForProject maps snake_case payload", async () => {
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

    await createTask("proj-001", {
      code: "T-1",
      title: "First task",
      status: "in_progress",
      estimate_md: 2.5,
      start_date: "2026-06-01",
      due_date: "2026-06-05",
      tags: ["plan"],
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/projects/proj-001/tasks",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"estimate_md":2.5'),
      }),
    );
    const body = String((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toContain('"status":"in_progress"');
    expect(body).toContain('"start_date":"2026-06-01"');
    expect(body).toContain('"due_date":"2026-06-05"');
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

  it("updateTask sends start_date/due_date patch values", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => RAW_TASK,
    });
    global.fetch = mockFetch;

    await updateTask("task-001", { start_date: "2026-06-05", due_date: "2026-07-01", version: 1 });

    const body = String((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toContain('"start_date":"2026-06-05"');
    expect(body).toContain('"due_date":"2026-07-01"');
  });

  it("updateTask serializes explicit nulls so the backend clears the fields", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ...RAW_TASK, assignee_id: null, reviewer_id: null, due_date: null, parent_id: null }),
    });
    global.fetch = mockFetch;

    const t = await updateTask("task-001", {
      assignee_id: null,
      reviewer_id: null,
      parent_id: null,
      due_date: null,
      version: 3,
    });

    // JSON.stringify must KEEP explicit nulls — they are the clear signal.
    const body = String((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toContain('"assignee_id":null');
    expect(body).toContain('"reviewer_id":null');
    expect(body).toContain('"parent_id":null');
    expect(body).toContain('"due_date":null');
    expect(t.assigneeId).toBeNull();
    expect(t.dueDate).toBeNull();
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

  it("addDependency sends predecessor_id + type + lag_days", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "dep-001",
        predecessor_id: "task-000",
        successor_id: "task-001",
        type: "ss",
        lag_days: 3,
      }),
    });
    global.fetch = mockFetch;

    const dep = await addDependency("task-001", { predecessor_id: "task-000", type: "ss", lag_days: 3 });
    expect(dep.id).toBe("dep-001");
    expect(dep.predecessorId).toBe("task-000");
    expect(dep.type).toBe("ss");
    expect(dep.lagDays).toBe(3);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/tasks/task-001/dependencies",
      expect.objectContaining({ method: "POST" }),
    );
    const body = String((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toContain('"predecessor_id":"task-000"');
    expect(body).toContain('"type":"ss"');
    expect(body).toContain('"lag_days":3');
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

  const RAW_COMMENT = {
    id: "c-1",
    tenant_id: "tenant-001",
    task_id: "task-001",
    author_id: "user-001",
    body: "looks good",
    version: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("listComments maps snake_case from {items}", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [RAW_COMMENT], total: 1 }) });
    global.fetch = mockFetch;
    const items = await listComments("task-001");
    expect(items[0].id).toBe("c-1");
    expect(items[0].authorId).toBe("user-001");
    expect(items[0].body).toBe("looks good");
    expect(items[0].version).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith("/api/tasks/task-001/comments");
  });

  it("createComment posts body + author_id", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => RAW_COMMENT });
    global.fetch = mockFetch;
    await createComment("task-001", "user-001", "looks good");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/tasks/task-001/comments",
      expect.objectContaining({ method: "POST" }),
    );
    const body = String((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toContain('"body":"looks good"');
    expect(body).toContain('"author_id":"user-001"');
  });

  it("updateComment PATCHes /api/pm/comments/:id with body+version", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...RAW_COMMENT, body: "edited", version: 2 }) });
    global.fetch = mockFetch;
    const c = await updateComment("c-1", "edited", 1);
    expect(c.body).toBe("edited");
    expect(c.version).toBe(2);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/pm/comments/c-1",
      expect.objectContaining({ method: "PATCH" }),
    );
    const body = String((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body).toContain('"body":"edited"');
    expect(body).toContain('"version":1');
  });

  it("updateComment surfaces 409 conflict message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "version conflict" }) });
    global.fetch = mockFetch;
    await expect(updateComment("c-1", "x", 1)).rejects.toThrow("version conflict");
  });

  it("deleteComment sends version query param", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = mockFetch;
    await deleteComment("c-1", 2);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/pm/comments/c-1?version=2",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
