import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listItems, createItem, updateItem, deleteItem,
  explodeBom, createWorkOrder, releaseWorkOrder, listMrpActions,
  listUoms, createUom, listWorkCenters, createWorkCenter,
  deleteUom, listLots, getLot, updateLot, getLotGenealogy,
  listRoutings, listRoutingOperations, traceForLot, updateBom,
  listWorkOrders, updateWorkOrder, createPurchaseOrder, listPurchaseOrders,
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

  // 11. deleteUom DELETEs the right URL
  it("deleteUom issues a DELETE to /uoms/{id}", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    global.fetch = mockFetch;
    await deleteUom("uom-ea");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/uoms/uom-ea",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  // 12. listWorkCenters maps machine_count (Go MachineCount + snake)
  it("listWorkCenters maps machine_count from Go keys", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { ID: "wc-1", TenantID: "t-1", Code: "WC1", Name: "Lathe", Type: "machine", CapacityPerDayHrs: 16, MachineCount: 7, Status: "active", CreatedAt: "", UpdatedAt: "", Version: 1 },
        ],
        total: 1,
      }),
    });
    const wcs = await listWorkCenters();
    expect(wcs[0].machineCount).toBe(7);
    expect(wcs[0].capacityPerDayHrs).toBe(16);
  });

  // 13. createWorkCenter forwards machine_count
  it("createWorkCenter forwards machine_count in body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ID: "wc-2", Code: "WC2", Name: "Mill", Type: "machine", CapacityPerDayHrs: 8, MachineCount: 3, Status: "active", Version: 1 }),
    });
    global.fetch = mockFetch;
    const wc = await createWorkCenter({ code: "WC2", name: "Mill", machine_count: 3 });
    expect(wc.machineCount).toBe(3);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/work-centers",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"machine_count":3') }),
    );
  });

  // 14. listLots normalizes notes + qty_on_hand
  it("listLots normalizes Go keys including Notes", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          { ID: "lot-1", TenantID: "t-1", ItemID: "i-1", LotNo: "L-001", QtyOnHand: 50, Status: "released", SourceWOID: null, Notes: "qa hold", CreatedAt: "" },
        ],
        total: 1,
      }),
    });
    const { items } = await listLots();
    expect(items[0].lotNo).toBe("L-001");
    expect(items[0].qtyOnHand).toBe(50);
    expect(items[0].notes).toBe("qa hold");
  });

  // 15. getLot fetches single lot
  it("getLot GETs /lots/{id}", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ID: "lot-9", ItemID: "i-1", LotNo: "L-009", QtyOnHand: 5, Status: "hold", Notes: "n", CreatedAt: "" }),
    });
    global.fetch = mockFetch;
    const lot = await getLot("lot-9");
    expect(lot.status).toBe("hold");
    expect(mockFetch).toHaveBeenCalledWith("/api/mfg/lots/lot-9", undefined);
  });

  // 16. updateLot PATCHes status + notes
  it("updateLot PATCHes /lots/{id} with status and notes", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ID: "lot-9", ItemID: "i-1", LotNo: "L-009", QtyOnHand: 5, Status: "hold", Notes: "updated", CreatedAt: "" }),
    });
    global.fetch = mockFetch;
    const lot = await updateLot("lot-9", { status: "hold", notes: "updated" });
    expect(lot.notes).toBe("updated");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/lots/lot-9",
      expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"notes":"updated"') }),
    );
  });

  // 17. getLotGenealogy handles {components:[...]} envelope
  it("getLotGenealogy maps component lots", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        components: [{ lot_id: "p-1", lot_no: "PARENT-1", item_id: "i-2", qty: 50 }],
        total: 1,
      }),
    });
    const g = await getLotGenealogy("lot-1");
    expect(g.components).toHaveLength(1);
    expect(g.components[0].lotId).toBe("p-1");
    expect(g.components[0].lotNumber).toBe("PARENT-1");
    expect(g.components[0].qty).toBe(50);
  });

  // 18. listRoutings GETs tenant-wide list and normalizes
  it("listRoutings normalizes routing headers", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ ID: "r-1", TenantID: "t-1", ItemID: "i-1", Version: 1, IsDefault: true, Status: "active", Notes: "", CreatedAt: "", UpdatedAt: "" }],
        total: 1,
      }),
    });
    const { items, total } = await listRoutings();
    expect(total).toBe(1);
    expect(items[0].id).toBe("r-1");
    expect(items[0].isDefault).toBe(true);
  });

  // 19. listRoutingOperations consumes {items:[...]}
  it("listRoutingOperations normalizes operations", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [{ ID: "op-1", TenantID: "t-1", RoutingID: "r-1", OpNo: 10, WorkCenterID: "wc-1", SetupMin: 15, RunPerUnitMin: 2.5, Description: "cut" }],
        total: 1,
      }),
    });
    const ops = await listRoutingOperations("r-1");
    expect(ops).toHaveLength(1);
    expect(ops[0].opNo).toBe(10);
    expect(ops[0].runPerUnitMin).toBe(2.5);
  });

  // 20. traceForLot consumes the flat array, maps qty_on_hand->qty, synthesizes root
  it("traceForLot maps flat closure array (qty_on_hand->qty) under a synthesized root", async () => {
    (global.fetch as MockFetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ([
        { lot_id: "child-1", depth: 1, item_id: "i-1", item_code: "Q-WEB-1", lot_no: "AUDIT-CHILD", status: "released", qty_on_hand: 50 },
      ]),
    });
    const root = await traceForLot("parent-1", "forward");
    expect(root.lot_id).toBe("parent-1"); // synthesized depth-0 root
    expect(root.depth).toBe(0);
    expect(root.children).toHaveLength(1);
    expect(root.children![0].lot_no).toBe("AUDIT-CHILD");
    expect(root.children![0].qty).toBe(50); // qty_on_hand mapped to qty
  });

  // 21. updateBom sends is_default:false (distinguishes absent vs false)
  it("updateBom forwards is_default:false", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ID: "bom-1", TenantID: "t-1", ItemID: "i-1", Version: 1, IsDefault: false, Status: "draft", Notes: "", CreatedAt: "", UpdatedAt: "" }),
    });
    global.fetch = mockFetch;
    const bom = await updateBom("bom-1", { is_default: false });
    expect(bom.isDefault).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/boms/bom-1",
      expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"is_default":false') }),
    );
  });

  // 22. createWorkOrder forwards source_so_id and normalizes SourceSoID (PascalCase) back
  it("createWorkOrder forwards source_so_id and maps SourceSoID back", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ID: "wo-so", TenantID: "t-1", Code: "WO-SO", ItemID: "i-1", Qty: 5,
        QtyCompleted: 0, Status: "planned", Priority: "med", DueDate: null,
        WorkCenterID: null, StartAt: null, EndAt: null, RoutingHeaderID: null,
        BOMHeaderID: null, SourceSoID: "so-123", Notes: "", CreatedAt: "", UpdatedAt: "", Version: 1,
      }),
    });
    global.fetch = mockFetch;
    const wo = await createWorkOrder({ code: "WO-SO", item_id: "i-1", qty: 5, source_so_id: "so-123" });
    expect(wo.sourceSoId).toBe("so-123");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/work-orders",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"source_so_id":"so-123"') }),
    );
  });

  // 23. updateWorkOrder can clear the link (source_so_id:null) — null distinguishes clear from absent
  it("updateWorkOrder forwards source_so_id:null to clear the link", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ID: "wo-so", TenantID: "t-1", Code: "WO-SO", ItemID: "i-1", Qty: 5,
        QtyCompleted: 0, Status: "planned", Priority: "med", DueDate: null,
        WorkCenterID: null, StartAt: null, EndAt: null, RoutingHeaderID: null,
        BOMHeaderID: null, SourceSoID: null, Notes: "", CreatedAt: "", UpdatedAt: "", Version: 2,
      }),
    });
    global.fetch = mockFetch;
    const wo = await updateWorkOrder("wo-so", { source_so_id: null, version: 1 });
    expect(wo.sourceSoId).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/work-orders/wo-so",
      expect.objectContaining({ method: "PATCH", body: expect.stringContaining('"source_so_id":null') }),
    );
  });

  // 24. listWorkOrders threads source_so_id into the query string for FK-based filtering
  it("listWorkOrders passes source_so_id as a query param", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [], total: 0 }) });
    global.fetch = mockFetch;
    await listWorkOrders({ source_so_id: "so-123" });
    expect(mockFetch.mock.calls[0][0]).toContain("source_so_id=so-123");
  });

  // 25. createPurchaseOrder forwards source_so_id and maps SourceSoID back
  it("createPurchaseOrder forwards source_so_id and maps SourceSoID back", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ID: "po-so", TenantID: "t-1", PONumber: "PO-SO", SupplierID: "sup-1",
        Status: "draft", OrderDate: "2026-06-07", ExpectedDate: null,
        SourceSoID: "so-123", Notes: "", lines: [],
      }),
    });
    global.fetch = mockFetch;
    const po = await createPurchaseOrder({ supplier_id: "sup-1", source_so_id: "so-123" });
    expect(po.sourceSoId).toBe("so-123");
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/mfg/purchase-orders",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"source_so_id":"so-123"') }),
    );
  });

  // 26. listPurchaseOrders threads source_so_id into the query string
  it("listPurchaseOrders passes source_so_id as a query param", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [], total: 0 }) });
    global.fetch = mockFetch;
    await listPurchaseOrders({ source_so_id: "so-123" });
    expect(mockFetch.mock.calls[0][0]).toContain("source_so_id=so-123");
  });
});
