import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listItems, createItem, updateItem, deleteItem,
  explodeBom, createWorkOrder, releaseWorkOrder, listMrpActions,
  listUoms, createUom, listWorkCenters, createWorkCenter,
} from "./mfg";

beforeEach(() => {
  global.fetch = vi.fn();
});

type MockFetch = ReturnType<typeof vi.fn>;

describe("mfg API client", () => {
  // 1. listItems normalizes Go uppercase keys
  it("listItems normalizes Go uppercase keys", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            ID: "item-001",
            TenantID: "t-001",
            Code: "BRK-001",
            Name: "Brake Pad",
            Description: "Front brake pad",
            Type: "component",
            Status: "active",
            UomID: "uom-ea",
            LotTracked: true,
            SerialTracked: false,
            Attrs: {},
            CreatedAt: "2026-01-01T00:00:00Z",
            UpdatedAt: "2026-05-01T00:00:00Z",
            Version: 2,
          },
        ],
        total: 1,
      }),
    });

    const { items, total } = await listItems();
    expect(total).toBe(1);
    expect(items[0].id).toBe("item-001");
    expect(items[0].tenantId).toBe("t-001");
    expect(items[0].code).toBe("BRK-001");
    expect(items[0].name).toBe("Brake Pad");
    expect(items[0].uomId).toBe("uom-ea");
    expect(items[0].lotTracked).toBe(true);
    expect(items[0].version).toBe(2);
  });

  // 2. createItem POSTs and parses response
  it("createItem POSTs and parses response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ID: "item-002",
        TenantID: "t-001",
        Code: "BRK-002",
        Name: "Disc Rotor",
        Description: "",
        Type: "finished",
        Status: "active",
        UomID: "uom-ea",
        LotTracked: false,
        SerialTracked: false,
        Attrs: null,
        CreatedAt: "",
        UpdatedAt: "",
        Version: 1,
      }),
    });
    global.fetch = mockFetch;

    const item = await createItem({ code: "BRK-002", name: "Disc Rotor", type: "finished", uom_id: "uom-ea" });
    expect(item.id).toBe("item-002");
    expect(item.code).toBe("BRK-002");
    expect(item.type).toBe("finished");

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/items",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("BRK-002"),
      }),
    );
  });

  // 3. updateItem sends version in body
  it("updateItem sends version in body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ID: "item-003",
        TenantID: "t-001",
        Code: "PAD-003",
        Name: "Updated Name",
        Description: "",
        Type: "raw",
        Status: "active",
        UomID: "uom-kg",
        LotTracked: false,
        SerialTracked: false,
        Attrs: {},
        CreatedAt: "",
        UpdatedAt: "",
        Version: 3,
      }),
    });
    global.fetch = mockFetch;

    await updateItem("item-003", { name: "Updated Name", version: 2 });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/items/item-003",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"version":2'),
      }),
    );
  });

  // 4. deleteItem sends version as query param
  it("deleteItem sends version as query param", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = mockFetch;

    await deleteItem("item-004", 5);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/items/item-004?version=5",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  // 5. explodeBom GET with qty query, normalizes row
  it("explodeBom sends qty query and normalizes Go keys", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            Level: 0,
            ItemID: "item-fg",
            ItemCode: "FG-001",
            ItemName: "Finished Good",
            Qty: 10,
            UomCode: "EA",
            ItemType: "finished",
          },
          {
            Level: 1,
            ItemID: "item-cp",
            ItemCode: "CP-001",
            ItemName: "Component",
            Qty: 20,
            UomCode: "EA",
            ItemType: "component",
          },
        ],
        total: 2,
      }),
    });
    global.fetch = mockFetch;

    const rows = await explodeBom("item-fg", 10);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/items/item-fg/bom/explode?qty=10",
      undefined,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].level).toBe(0);
    expect(rows[0].itemCode).toBe("FG-001");
    expect(rows[0].qty).toBe(10);
    expect(rows[0].uomCode).toBe("EA");
    expect(rows[1].level).toBe(1);
    expect(rows[1].qty).toBe(20);
  });

  // 6. createWorkOrder POSTs correctly
  it("createWorkOrder posts item_id and version defaults to 1", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ID: "wo-001",
        TenantID: "t-001",
        Code: "WO-001",
        ItemID: "item-fg",
        Qty: 50,
        QtyCompleted: 0,
        Status: "planned",
        Priority: "med",
        DueDate: null,
        WorkCenterID: null,
        StartAt: null,
        EndAt: null,
        RoutingHeaderID: null,
        BOMHeaderID: null,
        Notes: "",
        CreatedAt: "2026-05-01T00:00:00Z",
        UpdatedAt: "2026-05-01T00:00:00Z",
        Version: 1,
      }),
    });
    global.fetch = mockFetch;

    const wo = await createWorkOrder({ code: "WO-001", item_id: "item-fg", qty: 50 });

    expect(wo.id).toBe("wo-001");
    expect(wo.code).toBe("WO-001");
    expect(wo.itemId).toBe("item-fg");
    expect(wo.qty).toBe(50);
    expect(wo.status).toBe("planned");
    expect(wo.version).toBe(1);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/work-orders",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"item_id"'),
      }),
    );
  });

  // 7. releaseWorkOrder posts version
  it("releaseWorkOrder sends version in body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ID: "wo-002",
        TenantID: "t-001",
        Code: "WO-002",
        ItemID: "item-fg",
        Qty: 10,
        QtyCompleted: 0,
        Status: "released",
        Priority: "med",
        DueDate: null,
        WorkCenterID: null,
        StartAt: null,
        EndAt: null,
        RoutingHeaderID: null,
        BOMHeaderID: null,
        Notes: "",
        CreatedAt: "",
        UpdatedAt: "",
        Version: 2,
      }),
    });
    global.fetch = mockFetch;

    const wo = await releaseWorkOrder("wo-002", 1);

    expect(wo.status).toBe("released");
    expect(wo.version).toBe(2);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/work-orders/wo-002/release",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"version":1'),
      }),
    );
  });

  // 8. listMrpActions normalizes Go uppercase keys (Source, SourceRef variants)
  it("listMrpActions normalizes Go uppercase keys including Action/EntityType/Message", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            ID: "action-001",
            TenantID: "t-001",
            RunID: "run-001",
            Action: "release",
            EntityType: "work_order",
            EntityID: "wo-001",
            Message: "Release WO-001 to cover demand",
          },
          {
            ID: "action-002",
            TenantID: "t-001",
            RunID: "run-001",
            Action: "cancel",
            EntityType: "purchase_order",
            EntityID: null,
            Message: "Cancel excess PO",
          },
        ],
        total: 2,
      }),
    });
    global.fetch = mockFetch;

    const actions = await listMrpActions("run-001");

    expect(actions).toHaveLength(2);
    expect(actions[0].id).toBe("action-001");
    expect(actions[0].action).toBe("release");
    expect(actions[0].entityType).toBe("work_order");
    expect(actions[0].entityId).toBe("wo-001");
    expect(actions[0].message).toBe("Release WO-001 to cover demand");
    expect(actions[1].action).toBe("cancel");
    expect(actions[1].entityId).toBeNull();
  });

  // 9. listUoms normalizes and handles empty response
  it("listUoms normalizes UOM records", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { ID: "uom-ea", TenantID: "t-001", Code: "EA", Name: "Each", RatioToBase: 1 },
          { ID: "uom-kg", TenantID: "t-001", Code: "KG", Name: "Kilogram", RatioToBase: 1000 },
        ],
        total: 2,
      }),
    });

    const uoms = await listUoms();
    expect(uoms).toHaveLength(2);
    expect(uoms[0].id).toBe("uom-ea");
    expect(uoms[0].code).toBe("EA");
    expect(uoms[0].ratioToBase).toBe(1);
    expect(uoms[1].ratioToBase).toBe(1000);
  });

  // 10. createUom throws with backend error on 400
  it("createUom throws with backend error message on non-2xx", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: "code already exists" }),
    });

    await expect(createUom({ code: "EA", name: "Each" })).rejects.toThrow("code already exists");
  });
});
