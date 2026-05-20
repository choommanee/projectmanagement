import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listApqp, createApqp,
  createPpap, listPpapElements, patchPpapElement,
  listFmea, addFmeaMode,
  listControlPlans, addControlPlanChar,
  listNCRs, createNCR, attachCAPA, updateNCR,
  getCAPA,
} from "./quality";

beforeEach(() => {
  global.fetch = vi.fn();
});

type MockFetch = ReturnType<typeof vi.fn>;

describe("quality API client", () => {
  // 1. listApqp normalizes Go uppercase keys
  it("listApqp normalizes Go uppercase keys", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            ID: "apqp-001",
            ItemID: "item-001",
            WorkOrderID: null,
            Name: "Brake APQP",
            Phase: "design",
            Status: "in_progress",
            Milestones: [{ Name: "Gate 1", Due: "2026-06-01", Done: false }],
            OwnerID: "user-001",
            TargetDate: "2026-12-31T00:00:00Z",
            CreatedAt: "2026-01-01T00:00:00Z",
            UpdatedAt: "2026-05-01T00:00:00Z",
            Version: 2,
          },
        ],
      }),
    });

    const list = await listApqp();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("apqp-001");
    expect(list[0].itemId).toBe("item-001");
    expect(list[0].name).toBe("Brake APQP");
    expect(list[0].phase).toBe("design");
    expect(list[0].status).toBe("in_progress");
    expect(list[0].milestones).toHaveLength(1);
    expect(list[0].milestones[0].name).toBe("Gate 1");
    expect(list[0].milestones[0].done).toBe(false);
    expect(list[0].ownerId).toBe("user-001");
    expect(list[0].version).toBe(2);
  });

  // 2. createApqp POSTs and returns normalized project
  it("createApqp posts body and returns project", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "apqp-002",
        item_id: "item-002",
        work_order_id: null,
        name: "New APQP",
        phase: "concept",
        status: "not_started",
        milestones: [],
        owner_id: "",
        target_date: null,
        created_at: "2026-05-20T00:00:00Z",
        updated_at: "2026-05-20T00:00:00Z",
        version: 1,
      }),
    });
    global.fetch = mockFetch;

    const p = await createApqp({ item_id: "item-002", name: "New APQP" });
    expect(p.id).toBe("apqp-002");
    expect(p.name).toBe("New APQP");
    expect(p.phase).toBe("concept");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/quality/apqp",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("item-002") }),
    );
  });

  // 3. createPpap returns submission with level + status
  it("createPpap returns submission with level and draft status", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ID: "ppap-001",
        ItemID: "item-001",
        PartNo: "PN-001",
        Customer: "OEM Corp",
        Level: 3,
        Status: "draft",
        SubmittedAt: null,
        DecisionAt: null,
        Notes: "",
        Version: 1,
      }),
    });

    const p = await createPpap({ item_id: "item-001", part_no: "PN-001", customer: "OEM Corp", level: 3 });
    expect(p.id).toBe("ppap-001");
    expect(p.partNo).toBe("PN-001");
    expect(p.customer).toBe("OEM Corp");
    expect(p.level).toBe(3);
    expect(p.status).toBe("draft");
  });

  // 4. listPpapElements normalizes and returns 18 elements
  it("listPpapElements normalizes element list", async () => {
    const elements = Array.from({ length: 18 }, (_, i) => ({
      ID: `el-${i + 1}`,
      SubmissionID: "ppap-001",
      ElementNo: i + 1,
      Name: `Element ${i + 1}`,
      Status: "not_required",
      EvidenceUrl: "",
      Notes: "",
      UpdatedAt: "2026-05-01T00:00:00Z",
    }));
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: elements }),
    });

    const list = await listPpapElements("ppap-001");
    expect(list).toHaveLength(18);
    expect(list[0].id).toBe("el-1");
    expect(list[0].elementNo).toBe(1);
    expect(list[0].status).toBe("not_required");
    expect(list[17].elementNo).toBe(18);
  });

  // 5. patchPpapElement sends body with status + evidence_url
  it("patchPpapElement sends correct body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "el-001",
        submission_id: "ppap-001",
        element_no: 1,
        name: "Design Records",
        status: "complete",
        evidence_url: "https://example.com/doc",
        notes: "Verified",
        updated_at: "2026-05-20T00:00:00Z",
      }),
    });
    global.fetch = mockFetch;

    const el = await patchPpapElement("el-001", { status: "complete", evidence_url: "https://example.com/doc", notes: "Verified" });
    expect(el.status).toBe("complete");
    expect(el.evidenceUrl).toBe("https://example.com/doc");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/quality/ppap-elements/el-001",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining("complete"),
      }),
    );
  });

  // 6. listFmea normalizes team as array
  it("listFmea normalizes team field", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            ID: "fmea-001",
            Type: "pfmea",
            ItemID: "item-001",
            Name: "Assembly FMEA",
            Team: ["Alice", "Bob"],
            Status: "draft",
            Version: 1,
          },
        ],
      }),
    });

    const list = await listFmea();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("fmea-001");
    expect(list[0].type).toBe("pfmea");
    expect(list[0].team).toEqual(["Alice", "Bob"]);
  });

  // 7. addFmeaMode posts and RPN field is present
  it("addFmeaMode posts and RPN is present in response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "mode-001",
        fmea_id: "fmea-001",
        function: "Tighten bolt",
        failure_mode: "Under-torque",
        effect: "Vibration",
        severity: 7,
        cause: "Operator error",
        occurrence: 4,
        detection: 3,
        rpn: 84,
        actions: "Add torque check",
        target_date: null,
        sort_order: 0,
      }),
    });
    global.fetch = mockFetch;

    const m = await addFmeaMode("fmea-001", {
      function: "Tighten bolt",
      failure_mode: "Under-torque",
      severity: 7,
      occurrence: 4,
      detection: 3,
    });

    expect(m.id).toBe("mode-001");
    expect(m.rpn).toBe(84);
    expect(m.severity).toBe(7);
    expect(m.occurrence).toBe(4);
    expect(m.detection).toBe(3);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/quality/fmea/fmea-001/modes",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // 8. listControlPlans normalizes
  it("listControlPlans normalizes control plan list", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { ID: "cp-001", ItemID: "item-001", Name: "Assembly CP", Status: "draft", Version: 1, Notes: "" },
        ],
      }),
    });

    const list = await listControlPlans();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("cp-001");
    expect(list[0].itemId).toBe("item-001");
    expect(list[0].name).toBe("Assembly CP");
    expect(list[0].status).toBe("draft");
  });

  // 9. addControlPlanChar posts and normalizes characteristic
  it("addControlPlanChar posts characteristic and normalizes", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "char-001",
        control_plan_id: "cp-001",
        no: 1,
        characteristic: "Torque",
        spec: "20±2 Nm",
        sample_size: 5,
        sample_freq: "per batch",
        measurement_method: "Torque wrench",
        reaction_plan: "Rework",
        sort_order: 0,
      }),
    });
    global.fetch = mockFetch;

    const c = await addControlPlanChar("cp-001", { no: 1, characteristic: "Torque", spec: "20±2 Nm", sample_size: 5 });
    expect(c.id).toBe("char-001");
    expect(c.characteristic).toBe("Torque");
    expect(c.spec).toBe("20±2 Nm");
    expect(c.sampleSize).toBe(5);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/quality/control-plans/cp-001/characteristics",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // 10. listNCRs normalizes and returns list
  it("listNCRs normalizes NCR list", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            ID: "ncr-001",
            ItemID: "item-001",
            LotID: null,
            WorkOrderID: null,
            Qty: 5,
            Severity: 4,
            Description: "Surface scratch",
            Status: "open",
            CreatedAt: "2026-05-01T00:00:00Z",
            UpdatedAt: "2026-05-01T00:00:00Z",
            Version: 1,
          },
        ],
      }),
    });

    const list = await listNCRs();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("ncr-001");
    expect(list[0].qty).toBe(5);
    expect(list[0].severity).toBe(4);
    expect(list[0].status).toBe("open");
    expect(list[0].description).toBe("Surface scratch");
  });

  // 11. createNCR posts and returns normalized NCR
  it("createNCR posts and returns NCR", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "ncr-002",
        item_id: "item-001",
        lot_id: null,
        work_order_id: null,
        qty: 3,
        severity: 3,
        description: "Dimensional out-of-spec",
        status: "open",
        created_at: "2026-05-20T00:00:00Z",
        updated_at: "2026-05-20T00:00:00Z",
        version: 1,
      }),
    });
    global.fetch = mockFetch;

    const n = await createNCR({ item_id: "item-001", qty: 3, severity: 3, description: "Dimensional out-of-spec" });
    expect(n.id).toBe("ncr-002");
    expect(n.qty).toBe(3);
    expect(n.severity).toBe(3);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/quality/ncrs",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("item-001") }),
    );
  });

  // 12. attachCAPA posts and normalizes CAPA
  it("attachCAPA posts to ncr capa endpoint and normalizes", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "capa-001",
        nonconformance_id: "ncr-001",
        root_cause: "Tooling wear",
        action: "Replace tooling",
        owner_id: "user-001",
        target_date: "2026-06-30T00:00:00Z",
        status: "open",
        evidence: "",
        created_at: "2026-05-20T00:00:00Z",
        updated_at: "2026-05-20T00:00:00Z",
      }),
    });
    global.fetch = mockFetch;

    const c = await attachCAPA("ncr-001", { root_cause: "Tooling wear", action: "Replace tooling" });
    expect(c.id).toBe("capa-001");
    expect(c.rootCause).toBe("Tooling wear");
    expect(c.action).toBe("Replace tooling");
    expect(c.nonconformanceId).toBe("ncr-001");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/quality/ncrs/ncr-001/capa",
      expect.objectContaining({ method: "POST" }),
    );
  });

  // 13. updateNCR sends version in body
  it("updateNCR sends version in patch body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "ncr-001",
        item_id: "item-001",
        lot_id: null,
        work_order_id: null,
        qty: 5,
        severity: 4,
        description: "Surface scratch",
        status: "investigating",
        created_at: "2026-05-01T00:00:00Z",
        updated_at: "2026-05-20T00:00:00Z",
        version: 2,
      }),
    });
    global.fetch = mockFetch;

    const n = await updateNCR("ncr-001", { status: "investigating", version: 1 });
    expect(n.status).toBe("investigating");
    expect(n.version).toBe(2);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/quality/ncrs/ncr-001",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"version":1'),
      }),
    );
  });

  // 14. getCAPA returns null on 404
  it("getCAPA returns null when backend returns 404", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "not found" }),
    });

    const capa = await getCAPA("ncr-no-capa");
    expect(capa).toBeNull();
  });

  // 15. createApqp throws with backend error on 400
  it("createApqp throws with backend error message", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "item_id required" }),
    });

    await expect(createApqp({ item_id: "", name: "X" })).rejects.toThrow("item_id required");
  });
});
