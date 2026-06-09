import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROLE_CONFIG,
  isOpen,
  listRoleDocs,
  listRoleProjects,
  listRoleTasks,
  loadRoleWorkspace,
} from "./roleWorkspace";

beforeEach(() => {
  global.fetch = vi.fn();
});

function ok(body: unknown) {
  return { ok: true, json: async () => body };
}

describe("roleWorkspace client", () => {
  it("listRoleTasks maps snake_case and joins tags into a comma overlap filter", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      ok({
        items: [
          {
            id: "t-1",
            project_id: "p-1",
            code: "T-1",
            title: "Analyse requirements",
            type: "risk",
            status: "in_progress",
            priority: "high",
            assignee_id: "u-1",
            reviewer_id: null,
            progress_pct: 40,
            due_date: "2026-07-01",
            tags: ["ba", "analysis"],
            updated_at: "2026-06-01T00:00:00Z",
          },
        ],
        total: 1,
      }),
    );
    global.fetch = mockFetch;

    const { items, total } = await listRoleTasks({
      tag: ["ba", "analysis"],
      type: "risk",
      reviewer: "u-9",
    });
    expect(total).toBe(1);
    expect(items[0].id).toBe("t-1");
    expect(items[0].projectId).toBe("p-1");
    expect(items[0].progressPct).toBe(40);
    expect(items[0].tags).toEqual(["ba", "analysis"]);

    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("tag=ba%2Canalysis");
    expect(url).toContain("type=risk");
    expect(url).toContain("reviewer=u-9");
  });

  it("normalises PascalCase task payloads as a fallback", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      ok({
        items: [{ ID: "t-2", ProjectID: "p-2", Title: "Legacy", Status: "todo", Tags: ["go"] }],
        total: 1,
      }),
    );
    const { items } = await listRoleTasks();
    expect(items[0].id).toBe("t-2");
    expect(items[0].projectId).toBe("p-2");
    expect(items[0].title).toBe("Legacy");
    expect(items[0].tags).toEqual(["go"]);
  });

  it("listRoleProjects and listRoleDocs handle null/empty item arrays", async () => {
    global.fetch = vi.fn().mockResolvedValue(ok({ items: null, total: 0 }));
    const proj = await listRoleProjects();
    expect(proj.items).toEqual([]);
    const docs = await listRoleDocs();
    expect(docs.items).toEqual([]);
  });

  it("listRoleTasks throws on non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(listRoleTasks()).rejects.toThrow("role tasks failed: 500");
  });

  it("isOpen treats done/cancelled as closed", () => {
    expect(isOpen("todo")).toBe(true);
    expect(isOpen("in_progress")).toBe(true);
    expect(isOpen("done")).toBe(false);
    expect(isOpen("cancelled")).toBe(false);
  });

  it("loadRoleWorkspace(ba) composes open tasks, role-typed docs, discovery projects and KPIs", async () => {
    // URL-routed mock so call ORDER (Promise.all) does not matter.
    global.fetch = vi.fn().mockImplementation((input: string) => {
      const url = String(input);
      if (url.startsWith("/api/tasks")) {
        // both the tag query and the spotlight (type=risk) query hit /api/tasks
        if (url.includes("type=risk")) {
          return Promise.resolve(
            ok({
              items: [
                {
                  id: "r-1",
                  project_id: "p-1",
                  code: "RK-1",
                  title: "Open risk",
                  type: "risk",
                  status: "todo",
                  tags: ["risk"],
                },
                {
                  id: "r-2",
                  project_id: "p-1",
                  code: "RK-2",
                  title: "Closed risk",
                  type: "risk",
                  status: "done",
                  tags: ["risk"],
                },
              ],
              total: 2,
            }),
          );
        }
        return Promise.resolve(
          ok({
            items: [
              {
                id: "a-1",
                project_id: "p-1",
                code: "T-1",
                title: "Open BA task",
                type: "task",
                status: "in_progress",
                tags: ["ba"],
                updated_at: "2026-06-02T00:00:00Z",
              },
              {
                id: "a-2",
                project_id: "p-1",
                code: "T-2",
                title: "Done BA task",
                type: "task",
                status: "done",
                tags: ["ba"],
                updated_at: "2026-06-01T00:00:00Z",
              },
            ],
            total: 2,
          }),
        );
      }
      if (url.startsWith("/api/documents")) {
        return Promise.resolve(
          ok({
            items: [
              {
                id: "d-1",
                project_id: "p-1",
                type: "brd",
                title: "BRD",
                status: "draft",
                tags: [],
                updated_at: "2026-06-03T00:00:00Z",
              },
              {
                id: "d-2",
                project_id: "p-1",
                type: "risk_register",
                title: "Risks",
                status: "approved",
                tags: [],
                updated_at: "2026-06-02T00:00:00Z",
              },
              {
                id: "d-3",
                project_id: "p-1",
                type: "sdd",
                title: "Arch (not BA)",
                status: "draft",
                tags: [],
                updated_at: "2026-06-01T00:00:00Z",
              },
            ],
            total: 3,
          }),
        );
      }
      if (url.startsWith("/api/projects")) {
        return Promise.resolve(
          ok({
            items: [
              {
                id: "p-1",
                code: "PRJ-1",
                name: "Discovery",
                status: "planning",
                updated_at: "2026-06-01T00:00:00Z",
              },
            ],
            total: 1,
          }),
        );
      }
      return Promise.resolve(ok({ items: [], total: 0 }));
    });

    const data = await loadRoleWorkspace("ba");

    // open role tasks: a-1 only (a-2 is done)
    expect(data.kpis.openTasks).toBe(1);
    expect(data.roleTasks[0].id).toBe("a-1");
    expect(data.roleTasksTotal).toBe(2);

    // spotlight risks: r-1 only (r-2 done)
    expect(data.kpis.spotlight).toBe(1);
    expect(data.spotlightTasks[0].id).toBe("r-1");

    // docs bucketed to BA types: brd + risk_register (sdd excluded)
    expect(data.kpis.docs).toBe(2);
    expect(data.docs.map((d) => d.type).sort()).toEqual(["brd", "risk_register"]);
    expect(data.docsInProgress).toBe(1); // only brd is draft

    // discovery projects
    expect(data.kpis.projects).toBe(1);
    expect(data.projects[0].id).toBe("p-1");
  });

  it("loadRoleWorkspace(expert) uses reviewer filter for the spotlight", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn().mockImplementation((input: string) => {
      const url = String(input);
      calls.push(url);
      return Promise.resolve(ok({ items: [], total: 0 }));
    });

    await loadRoleWorkspace("expert", "me-123");
    expect(calls.some((u) => u.includes("reviewer=me-123"))).toBe(true);
    expect(ROLE_CONFIG.expert.spotlightReviewer).toBe(true);
  });

  it("loadRoleWorkspace(expert) skips the reviewer query when no user id is given", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn().mockImplementation((input: string) => {
      calls.push(String(input));
      return Promise.resolve(ok({ items: [], total: 0 }));
    });
    const data = await loadRoleWorkspace("expert");
    expect(calls.some((u) => u.includes("reviewer="))).toBe(false);
    expect(data.kpis.spotlight).toBe(0);
  });
});
