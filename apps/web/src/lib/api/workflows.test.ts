import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listWorkflows,
  createWorkflow,
  saveVersion,
  publishVersion,
  startInstance,
  getInstance,
  listHumanTasks,
  completeHumanTask,
} from "./workflows";

beforeEach(() => {
  global.fetch = vi.fn();
});

type MockFetch = ReturnType<typeof vi.fn>;

describe("workflows API client", () => {
  // 1. listWorkflows normalizes
  it("listWorkflows normalizes Go uppercase keys", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            ID: "wf-001",
            Name: "Test Flow",
            Description: "A test",
            Trigger: { type: "manual" },
            Status: "draft",
            current_version: 1,
            CreatedAt: "2026-01-01T00:00:00Z",
            UpdatedAt: "2026-05-01T00:00:00Z",
            Version: 2,
          },
        ],
        total: 1,
      }),
    });

    const { items, total } = await listWorkflows();
    expect(total).toBe(1);
    expect(items[0].id).toBe("wf-001");
    expect(items[0].name).toBe("Test Flow");
    expect(items[0].status).toBe("draft");
    expect(items[0].currentVersion).toBe(1);
    expect(items[0].version).toBe(2);
  });

  // 2. createWorkflow posts and returns normalized workflow
  it("createWorkflow POSTs and normalizes response", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ID: "wf-002",
        Name: "My Workflow",
        Description: "",
        Status: "draft",
        current_version: 0,
        CreatedAt: "2026-01-01T00:00:00Z",
        UpdatedAt: "2026-01-01T00:00:00Z",
        Version: 1,
      }),
    });

    const wf = await createWorkflow({ name: "My Workflow" });
    expect(wf.id).toBe("wf-002");
    expect(wf.name).toBe("My Workflow");

    const call = (global.fetch as MockFetch).mock.calls[0];
    expect(call[0]).toContain("/api/workflows/workflows");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body as string);
    expect(body.name).toBe("My Workflow");
  });

  // 3. saveVersion sends dsl
  it("saveVersion sends dsl to versions endpoint", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ID: "ver-001",
        definition_id: "wf-001",
        Rev: 1,
        Dsl: { id: "v1", steps: [] },
        Notes: "initial",
        CreatedAt: "2026-01-01T00:00:00Z",
      }),
    });

    const dsl = { id: "v1", steps: [{ id: "end", type: "end", result: "ok" }] };
    const ver = await saveVersion("wf-001", { dsl, notes: "initial" });
    expect(ver.rev).toBe(1);
    expect(ver.notes).toBe("initial");

    const call = (global.fetch as MockFetch).mock.calls[0];
    expect(call[0]).toContain("/api/workflows/workflows/wf-001/versions");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body as string);
    expect(body.dsl).toEqual(dsl);
  });

  // 4. publishVersion sends rev+version
  it("publishVersion sends rev and version", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ID: "wf-001",
        Name: "Test Flow",
        Description: "",
        Status: "published",
        current_version: 1,
        CreatedAt: "2026-01-01T00:00:00Z",
        UpdatedAt: "2026-05-01T00:00:00Z",
        Version: 2,
      }),
    });

    const wf = await publishVersion("wf-001", { rev: 1, version: 2 });
    expect(wf.status).toBe("published");

    const call = (global.fetch as MockFetch).mock.calls[0];
    expect(call[0]).toContain("/api/workflows/workflows/wf-001/publish");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body as string);
    expect(body.rev).toBe(1);
    expect(body.version).toBe(2);
  });

  // 5. startInstance posts input
  it("startInstance POSTs input and returns instance", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ID: "inst-001",
        definition_id: "wf-001",
        version_id: "ver-001",
        Status: "completed",
        Input: { x: 5 },
        Output: { y: 15 },
        Variables: {},
        trigger_kind: "manual",
        started_at: "2026-01-01T00:00:00Z",
      }),
    });

    const inst = await startInstance("wf-001", { input: { x: 5 } });
    expect(inst.id).toBe("inst-001");
    expect(inst.status).toBe("completed");

    const call = (global.fetch as MockFetch).mock.calls[0];
    expect(call[0]).toContain("/api/workflows/workflows/wf-001/start");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body as string);
    expect(body.input).toEqual({ x: 5 });
  });

  // 6. getInstance normalizes steps + human_tasks arrays
  it("getInstance normalizes steps and human_tasks", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ID: "inst-001",
        definition_id: "wf-001",
        version_id: "ver-001",
        Status: "completed",
        Input: {},
        Output: {},
        Variables: { y: 15 },
        trigger_kind: "manual",
        steps: [
          {
            ID: "step-001",
            instance_id: "inst-001",
            step_id: "calc",
            step_type: "expression",
            Status: "completed",
            Input: { x: 5 },
            Output: { y: 15 },
            started_at: "2026-01-01T00:00:00Z",
            ended_at: "2026-01-01T00:00:01Z",
          },
        ],
        human_tasks: [],
      }),
    });

    const detail = await getInstance("inst-001");
    expect(detail.id).toBe("inst-001");
    expect(detail.steps).toHaveLength(1);
    expect(detail.steps[0].stepId).toBe("calc");
    expect(detail.steps[0].stepType).toBe("expression");
    expect(detail.steps[0].status).toBe("completed");
    expect(detail.human_tasks).toHaveLength(0);
    expect(detail.variables).toEqual({ y: 15 });
  });

  // 7. listHumanTasks normalizes
  it("listHumanTasks normalizes tasks array", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            ID: "ht-001",
            instance_id: "inst-001",
            step_id: "approve",
            assignee_id: "user-001",
            Form: { prompt: "Approve?" },
            outcome: null,
            sla_deadline: "2026-06-01T00:00:00Z",
            CreatedAt: "2026-01-01T00:00:00Z",
            completed_at: null,
          },
        ],
        total: 1,
      }),
    });

    const { items, total } = await listHumanTasks({ status: "open" });
    expect(total).toBe(1);
    expect(items[0].id).toBe("ht-001");
    expect(items[0].instanceId).toBe("inst-001");
    expect(items[0].stepId).toBe("approve");
    expect(items[0].assigneeId).toBe("user-001");
    expect(items[0].slaDeadline).toBe("2026-06-01T00:00:00Z");

    const call = (global.fetch as MockFetch).mock.calls[0];
    expect(call[0]).toContain("/api/workflows/human-tasks");
    expect(call[0]).toContain("status=open");
  });

  // 8. completeHumanTask posts outcome
  it("completeHumanTask POSTs outcome and data", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await completeHumanTask("ht-001", { outcome: "approve", data: { comment: "LGTM" } });

    const call = (global.fetch as MockFetch).mock.calls[0];
    expect(call[0]).toContain("/api/workflows/human-tasks/ht-001/complete");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body as string);
    expect(body.outcome).toBe("approve");
    expect(body.data).toEqual({ comment: "LGTM" });
  });
});
