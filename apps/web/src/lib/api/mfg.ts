// ─── helpers ───────────────────────────────────────────────────────────────
// g: check camelCase, PascalCase, and Go ALL_CAPS (e.g. ID, TenantID)
function g(r: Record<string, unknown>, k: string) {
  return r[k] ?? r[k[0].toUpperCase() + k.slice(1)];
}

// gid: g() + underscore-id variants (e.g. tenant_id, TenantID)
function gid(r: Record<string, unknown>, camel: string, snake: string): unknown {
  // Convert camelCase to PascalCase with Go embedded IDs uppercased: tenantId → TenantID
  const goKey = camel
    .replace(/^(.)/, (c) => c.toUpperCase())
    .replace(/Id$/, "ID")
    .replace(/Id([A-Z])/, "ID$1");
  return r[camel] ?? r[snake] ?? r[goKey] ?? r[camel[0].toUpperCase() + camel.slice(1)];
}

const SVC = "/api/mfg";

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, opts);
}

// ─── types ─────────────────────────────────────────────────────────────────

export interface UOM {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  ratioToBase: number;
}

export type ItemType = "raw" | "component" | "assembly" | "finished" | "consumable" | "service";
export type ItemStatus = "active" | "inactive" | "obsolete";

export interface Item {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string;
  type: ItemType;
  status: ItemStatus;
  uomId: string;
  lotTracked: boolean;
  serialTracked: boolean;
  attrs: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type WCType = "machine" | "labor" | "cell";

export interface WorkCenter {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: WCType;
  capacityPerDayHrs: number;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type BOMStatus = "draft" | "active" | "obsolete";

export interface BOMHeader {
  id: string;
  tenantId: string;
  itemId: string;
  version: number;
  isDefault: boolean;
  status: BOMStatus;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lines?: BOMLine[];
}

export interface BOMLine {
  id: string;
  tenantId: string;
  headerId: string;
  childItemId: string;
  qty: number;
  uomId: string;
  alternateOfId?: string | null;
  isPhantom: boolean;
  scrapPct: number;
  sortOrder: number;
  notes: string;
}

export interface BomExplodeRow {
  level: number;
  itemId: string;
  itemCode: string;
  itemName: string;
  qty: number;
  uomCode: string;
  itemType: ItemType;
}

export interface RoutingHeader {
  id: string;
  tenantId: string;
  itemId: string;
  version: number;
  isDefault: boolean;
  status: BOMStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  operations?: RoutingOperation[];
}

export interface RoutingOperation {
  id: string;
  tenantId: string;
  routingId: string;
  opNo: number;
  workCenterId: string;
  setupMin: number;
  runPerUnitMin: number;
  description: string;
}

export type WOStatus = "planned" | "released" | "in_progress" | "completed" | "closed" | "cancelled";
export type WOPriority = "low" | "med" | "high" | "critical";

export interface WorkOrder {
  id: string;
  tenantId: string;
  code: string;
  itemId: string;
  qty: number;
  qtyCompleted: number;
  status: WOStatus;
  priority: WOPriority;
  dueDate?: string | null;
  workCenterId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  routingHeaderId?: string | null;
  bomHeaderId?: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface WOOperation {
  id: string;
  tenantId: string;
  workOrderId: string;
  opNo: number;
  workCenterId: string;
  setupMin: number;
  runPerUnitMin: number;
  description: string;
  qtyDone: number;
  status: WOStatus;
}

export interface WOMaterial {
  id: string;
  tenantId: string;
  workOrderId: string;
  itemId: string;
  qtyRequired: number;
  qtyIssued: number;
  uomId: string;
}

export type LotStatus = "released" | "hold" | "quarantine" | "consumed";

export interface Lot {
  id: string;
  tenantId: string;
  itemId: string;
  lotNo: string;
  qtyOnHand: number;
  status: LotStatus;
  sourceWoId?: string | null;
  createdAt: string;
}

export interface MrpRun {
  id: string;
  tenantId: string;
  name: string;
  runAt: string;
  params?: Record<string, unknown>;
  note?: string;
  demandCount?: number;
  supplyCount?: number;
  actionCount?: number;
}

export type MrpSource = "sales" | "wo" | "forecast" | "po" | "stock";

export interface MrpDemand {
  id: string;
  tenantId: string;
  runId: string;
  itemId: string;
  qty: number;
  dueDate?: string | null;
  source: MrpSource;
  sourceRef: string;
}

export interface MrpSupply {
  id: string;
  tenantId: string;
  runId: string;
  itemId: string;
  qty: number;
  availableAt?: string | null;
  source: MrpSource;
  sourceRef: string;
}

export type MrpActionKind = "release" | "reschedule" | "cancel" | "noop";

export interface MrpAction {
  id: string;
  tenantId: string;
  runId: string;
  action: MrpActionKind;
  entityType: string;
  entityId?: string | null;
  message: string;
}

// ─── normalizers ────────────────────────────────────────────────────────────

function normUOM(r: Record<string, unknown>): UOM {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    code: String(g(r, "code") ?? ""),
    name: String(g(r, "name") ?? ""),
    ratioToBase: Number(gid(r, "ratioToBase", "ratio_to_base") ?? 1),
  };
}

function normItem(r: Record<string, unknown>): Item {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    code: String(g(r, "code") ?? ""),
    name: String(g(r, "name") ?? ""),
    description: String(g(r, "description") ?? ""),
    type: (g(r, "type") ?? "component") as ItemType,
    status: (g(r, "status") ?? "active") as ItemStatus,
    uomId: String(gid(r, "uomId", "uom_id") ?? r["UomID"] ?? ""),
    lotTracked: Boolean(gid(r, "lotTracked", "lot_tracked") ?? false),
    serialTracked: Boolean(gid(r, "serialTracked", "serial_tracked") ?? false),
    attrs: ((g(r, "attrs") ?? null) as Record<string, unknown> | null) ?? {},
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
    version: Number(g(r, "version") ?? 1),
  };
}

function normWorkCenter(r: Record<string, unknown>): WorkCenter {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    code: String(g(r, "code") ?? ""),
    name: String(g(r, "name") ?? ""),
    type: (g(r, "type") ?? "machine") as WCType,
    capacityPerDayHrs: Number(gid(r, "capacityPerDayHrs", "capacity_per_day_hrs") ?? 8),
    status: (g(r, "status") ?? "active") as ItemStatus,
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
    version: Number(g(r, "version") ?? 1),
  };
}

function normBOMHeader(r: Record<string, unknown>): BOMHeader {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    version: Number(g(r, "version") ?? 1),
    isDefault: Boolean(gid(r, "isDefault", "is_default") ?? false),
    status: (g(r, "status") ?? "draft") as BOMStatus,
    effectiveFrom: (gid(r, "effectiveFrom", "effective_from") ?? null) as string | null,
    effectiveTo: (gid(r, "effectiveTo", "effective_to") ?? null) as string | null,
    notes: String(g(r, "notes") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
    lines: Array.isArray(r["lines"]) ? (r["lines"] as Record<string, unknown>[]).map(normBOMLine) : undefined,
  };
}

function normBOMLine(r: Record<string, unknown>): BOMLine {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    headerId: String(gid(r, "headerId", "header_id") ?? r["HeaderID"] ?? ""),
    childItemId: String(gid(r, "childItemId", "child_item_id") ?? r["ChildItemID"] ?? ""),
    qty: Number(g(r, "qty") ?? 0),
    uomId: String(gid(r, "uomId", "uom_id") ?? r["UomID"] ?? ""),
    alternateOfId: (gid(r, "alternateOfId", "alternate_of_id") ?? r["AlternateOfID"] ?? null) as string | null,
    isPhantom: Boolean(gid(r, "isPhantom", "is_phantom") ?? false),
    scrapPct: Number(gid(r, "scrapPct", "scrap_pct") ?? 0),
    sortOrder: Number(gid(r, "sortOrder", "sort_order") ?? 0),
    notes: String(g(r, "notes") ?? ""),
  };
}

function normBomExplodeRow(r: Record<string, unknown>): BomExplodeRow {
  return {
    level: Number(g(r, "level") ?? r["Level"] ?? r["Lvl"] ?? 0),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    itemCode: String(gid(r, "itemCode", "item_code") ?? r["ItemCode"] ?? r["Code"] ?? ""),
    itemName: String(gid(r, "itemName", "item_name") ?? r["ItemName"] ?? r["Name"] ?? ""),
    qty: Number(g(r, "qty") ?? r["Qty"] ?? 0),
    uomCode: String(gid(r, "uomCode", "uom_code") ?? r["UomCode"] ?? ""),
    itemType: (gid(r, "itemType", "item_type") ?? r["ItemType"] ?? "component") as ItemType,
  };
}

function normRoutingHeader(r: Record<string, unknown>): RoutingHeader {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    version: Number(g(r, "version") ?? 1),
    isDefault: Boolean(gid(r, "isDefault", "is_default") ?? false),
    status: (g(r, "status") ?? "draft") as BOMStatus,
    notes: String(g(r, "notes") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
    operations: Array.isArray(r["operations"]) ? (r["operations"] as Record<string, unknown>[]).map(normRoutingOperation) : undefined,
  };
}

function normRoutingOperation(r: Record<string, unknown>): RoutingOperation {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    routingId: String(gid(r, "routingId", "routing_id") ?? r["RoutingID"] ?? ""),
    opNo: Number(gid(r, "opNo", "op_no") ?? 0),
    workCenterId: String(gid(r, "workCenterId", "work_center_id") ?? r["WorkCenterID"] ?? ""),
    setupMin: Number(gid(r, "setupMin", "setup_min") ?? 0),
    runPerUnitMin: Number(gid(r, "runPerUnitMin", "run_per_unit_min") ?? 0),
    description: String(g(r, "description") ?? ""),
  };
}

function normWorkOrder(r: Record<string, unknown>): WorkOrder {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    code: String(g(r, "code") ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    qty: Number(g(r, "qty") ?? 0),
    qtyCompleted: Number(gid(r, "qtyCompleted", "qty_completed") ?? 0),
    status: (g(r, "status") ?? "planned") as WOStatus,
    priority: (g(r, "priority") ?? "med") as WOPriority,
    dueDate: (gid(r, "dueDate", "due_date") ?? r["DueDate"] ?? null) as string | null,
    workCenterId: (gid(r, "workCenterId", "work_center_id") ?? r["WorkCenterID"] ?? null) as string | null,
    startAt: (gid(r, "startAt", "start_at") ?? r["StartAt"] ?? null) as string | null,
    endAt: (gid(r, "endAt", "end_at") ?? r["EndAt"] ?? null) as string | null,
    routingHeaderId: (gid(r, "routingHeaderId", "routing_header_id") ?? r["RoutingHeaderID"] ?? null) as string | null,
    bomHeaderId: (gid(r, "bomHeaderId", "bom_header_id") ?? r["BOMHeaderID"] ?? null) as string | null,
    notes: String(g(r, "notes") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
    version: Number(g(r, "version") ?? 1),
  };
}

function normWOOperation(r: Record<string, unknown>): WOOperation {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    workOrderId: String(gid(r, "workOrderId", "work_order_id") ?? r["WorkOrderID"] ?? ""),
    opNo: Number(gid(r, "opNo", "op_no") ?? 0),
    workCenterId: String(gid(r, "workCenterId", "work_center_id") ?? r["WorkCenterID"] ?? ""),
    setupMin: Number(gid(r, "setupMin", "setup_min") ?? 0),
    runPerUnitMin: Number(gid(r, "runPerUnitMin", "run_per_unit_min") ?? 0),
    description: String(g(r, "description") ?? ""),
    qtyDone: Number(gid(r, "qtyDone", "qty_done") ?? 0),
    status: (g(r, "status") ?? "planned") as WOStatus,
  };
}

function normWOMaterial(r: Record<string, unknown>): WOMaterial {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    workOrderId: String(gid(r, "workOrderId", "work_order_id") ?? r["WorkOrderID"] ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    qtyRequired: Number(gid(r, "qtyRequired", "qty_required") ?? 0),
    qtyIssued: Number(gid(r, "qtyIssued", "qty_issued") ?? 0),
    uomId: String(gid(r, "uomId", "uom_id") ?? r["UomID"] ?? ""),
  };
}

function normLot(r: Record<string, unknown>): Lot {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    lotNo: String(gid(r, "lotNo", "lot_no") ?? ""),
    qtyOnHand: Number(gid(r, "qtyOnHand", "qty_on_hand") ?? 0),
    status: (g(r, "status") ?? "released") as LotStatus,
    sourceWoId: (gid(r, "sourceWoId", "source_wo_id") ?? r["SourceWOID"] ?? null) as string | null,
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
  };
}

function normMrpRun(r: Record<string, unknown>): MrpRun {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    name: String(g(r, "name") ?? ""),
    runAt: String(gid(r, "runAt", "run_at") ?? r["RunAt"] ?? ""),
    params: (g(r, "params") ?? null) as Record<string, unknown> | undefined,
    note: String(g(r, "note") ?? ""),
    demandCount: Number(gid(r, "demandCount", "demand_count") ?? 0),
    supplyCount: Number(gid(r, "supplyCount", "supply_count") ?? 0),
    actionCount: Number(gid(r, "actionCount", "action_count") ?? 0),
  };
}

function normMrpDemand(r: Record<string, unknown>): MrpDemand {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    runId: String(gid(r, "runId", "run_id") ?? r["RunID"] ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    qty: Number(g(r, "qty") ?? 0),
    dueDate: (gid(r, "dueDate", "due_date") ?? r["DueDate"] ?? null) as string | null,
    source: (g(r, "source") ?? "wo") as MrpSource,
    sourceRef: String(gid(r, "sourceRef", "source_ref") ?? r["SourceRef"] ?? ""),
  };
}

function normMrpSupply(r: Record<string, unknown>): MrpSupply {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    runId: String(gid(r, "runId", "run_id") ?? r["RunID"] ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    qty: Number(g(r, "qty") ?? 0),
    availableAt: (gid(r, "availableAt", "available_at") ?? r["AvailableAt"] ?? null) as string | null,
    source: (g(r, "source") ?? "stock") as MrpSource,
    sourceRef: String(gid(r, "sourceRef", "source_ref") ?? r["SourceRef"] ?? ""),
  };
}

function normMrpAction(r: Record<string, unknown>): MrpAction {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    runId: String(gid(r, "runId", "run_id") ?? r["RunID"] ?? ""),
    action: (g(r, "action") ?? "noop") as MrpActionKind,
    entityType: String(gid(r, "entityType", "entity_type") ?? r["EntityType"] ?? ""),
    entityId: (gid(r, "entityId", "entity_id") ?? r["EntityID"] ?? null) as string | null,
    message: String(g(r, "message") ?? ""),
  };
}

// ─── UOM ────────────────────────────────────────────────────────────────────

export async function listUoms(): Promise<UOM[]> {
  const r = await apiFetch(`${SVC}/uoms`);
  if (!r.ok) throw new Error(`listUoms failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normUOM);
}

export async function createUom(input: { code: string; name: string; ratio_to_base?: number }): Promise<UOM> {
  const r = await apiFetch(`${SVC}/uoms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createUom failed: ${r.status}`); }
  return normUOM(await r.json());
}

export async function getUom(id: string): Promise<UOM> {
  const r = await apiFetch(`${SVC}/uoms/${id}`);
  if (!r.ok) throw new Error(`getUom failed: ${r.status}`);
  return normUOM(await r.json());
}

// ─── Items ──────────────────────────────────────────────────────────────────

export async function listItems(params: { q?: string; type?: string; status?: string; limit?: number; offset?: number } = {}): Promise<{ items: Item[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.type) qs.set("type", params.type);
  if (params.status) qs.set("status", params.status);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("offset", String(params.offset ?? 0));
  const r = await apiFetch(`${SVC}/items?${qs}`);
  if (!r.ok) throw new Error(`listItems failed: ${r.status}`);
  const body = await r.json();
  return { items: ((body.items ?? []) as Record<string, unknown>[]).map(normItem), total: body.total ?? 0 };
}

export async function createItem(input: { code: string; name: string; type?: ItemType; status?: ItemStatus; uom_id: string; description?: string; lot_tracked?: boolean; serial_tracked?: boolean; attrs?: Record<string, unknown> }): Promise<Item> {
  const r = await apiFetch(`${SVC}/items`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createItem failed: ${r.status}`); }
  return normItem(await r.json());
}

export async function getItem(id: string): Promise<Item> {
  const r = await apiFetch(`${SVC}/items/${id}`);
  if (!r.ok) throw new Error(`getItem failed: ${r.status}`);
  return normItem(await r.json());
}

export async function updateItem(id: string, patch: { name?: string; description?: string; type?: ItemType; status?: ItemStatus; uom_id?: string; lot_tracked?: boolean; serial_tracked?: boolean; attrs?: Record<string, unknown>; version: number }): Promise<Item> {
  const r = await apiFetch(`${SVC}/items/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateItem failed: ${r.status}`); }
  return normItem(await r.json());
}

export async function deleteItem(id: string, version: number): Promise<void> {
  const r = await apiFetch(`${SVC}/items/${id}?version=${version}`, { method: "DELETE", headers: { "X-Confirm-Destructive": "true" } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `deleteItem failed: ${r.status}`); }
}

// ─── Work Centers ───────────────────────────────────────────────────────────

export async function listWorkCenters(): Promise<WorkCenter[]> {
  const r = await apiFetch(`${SVC}/work-centers`);
  if (!r.ok) throw new Error(`listWorkCenters failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normWorkCenter);
}

export async function createWorkCenter(input: { code: string; name: string; type?: WCType; capacity_per_day_hrs?: number }): Promise<WorkCenter> {
  const r = await apiFetch(`${SVC}/work-centers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createWorkCenter failed: ${r.status}`); }
  return normWorkCenter(await r.json());
}

export async function getWorkCenter(id: string): Promise<WorkCenter> {
  const r = await apiFetch(`${SVC}/work-centers/${id}`);
  if (!r.ok) throw new Error(`getWorkCenter failed: ${r.status}`);
  return normWorkCenter(await r.json());
}

export async function updateWorkCenter(id: string, patch: { name?: string; type?: WCType; capacity_per_day_hrs?: number; status?: ItemStatus; version: number }): Promise<WorkCenter> {
  const r = await apiFetch(`${SVC}/work-centers/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateWorkCenter failed: ${r.status}`); }
  return normWorkCenter(await r.json());
}

// ─── BOMs ───────────────────────────────────────────────────────────────────

export async function listBomsForItem(itemId: string): Promise<BOMHeader[]> {
  const r = await apiFetch(`${SVC}/items/${itemId}/boms`);
  if (!r.ok) throw new Error(`listBoms failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normBOMHeader);
}

export async function createBomForItem(itemId: string, body?: { notes?: string }): Promise<BOMHeader> {
  const r = await apiFetch(`${SVC}/items/${itemId}/boms`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createBom failed: ${r.status}`); }
  return normBOMHeader(await r.json());
}

export async function getBom(id: string): Promise<BOMHeader> {
  const r = await apiFetch(`${SVC}/boms/${id}`);
  if (!r.ok) throw new Error(`getBom failed: ${r.status}`);
  return normBOMHeader(await r.json());
}

export async function updateBom(id: string, patch: { is_default?: boolean; status?: BOMStatus; notes?: string }): Promise<BOMHeader> {
  const r = await apiFetch(`${SVC}/boms/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateBom failed: ${r.status}`); }
  return normBOMHeader(await r.json());
}

export async function addBomLine(headerId: string, line: { child_item_id: string; qty: number; uom_id: string; scrap_pct?: number; is_phantom?: boolean; sort_order?: number; notes?: string }): Promise<BOMLine> {
  const r = await apiFetch(`${SVC}/boms/${headerId}/lines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(line) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `addBomLine failed: ${r.status}`); }
  return normBOMLine(await r.json());
}

export async function updateBomLine(id: string, patch: { child_item_id?: string; qty?: number; uom_id?: string; scrap_pct?: number; is_phantom?: boolean; sort_order?: number; notes?: string }): Promise<BOMLine> {
  const r = await apiFetch(`${SVC}/bom-lines/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateBomLine failed: ${r.status}`); }
  return normBOMLine(await r.json());
}

export async function deleteBomLine(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/bom-lines/${id}`, { method: "DELETE" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `deleteBomLine failed: ${r.status}`); }
}

export async function activateBom(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/boms/${id}/activate`, { method: "POST" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `activateBom failed: ${r.status}`); }
}

export async function explodeBom(itemId: string, qty: number): Promise<BomExplodeRow[]> {
  const r = await apiFetch(`${SVC}/items/${itemId}/bom/explode?qty=${qty}`);
  if (!r.ok) throw new Error(`explodeBom failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normBomExplodeRow);
}

// ─── Routings ───────────────────────────────────────────────────────────────

export async function listRoutingsForItem(itemId: string): Promise<RoutingHeader[]> {
  const r = await apiFetch(`${SVC}/items/${itemId}/routings`);
  if (!r.ok) throw new Error(`listRoutings failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normRoutingHeader);
}

export async function createRoutingForItem(itemId: string, body?: { notes?: string }): Promise<RoutingHeader> {
  const r = await apiFetch(`${SVC}/items/${itemId}/routings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createRouting failed: ${r.status}`); }
  return normRoutingHeader(await r.json());
}

export async function getRouting(id: string): Promise<RoutingHeader> {
  const r = await apiFetch(`${SVC}/routings/${id}`);
  if (!r.ok) throw new Error(`getRouting failed: ${r.status}`);
  return normRoutingHeader(await r.json());
}

export async function addRoutingOperation(routingId: string, op: { op_no: number; work_center_id: string; setup_min?: number; run_per_unit_min?: number; description?: string }): Promise<RoutingOperation> {
  const r = await apiFetch(`${SVC}/routings/${routingId}/operations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(op) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `addRoutingOp failed: ${r.status}`); }
  return normRoutingOperation(await r.json());
}

export async function updateRoutingOperation(id: string, patch: { op_no?: number; work_center_id?: string; setup_min?: number; run_per_unit_min?: number; description?: string }): Promise<RoutingOperation> {
  const r = await apiFetch(`${SVC}/routing-operations/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateRoutingOp failed: ${r.status}`); }
  return normRoutingOperation(await r.json());
}

export async function deleteRoutingOperation(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/routing-operations/${id}`, { method: "DELETE" });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `deleteRoutingOp failed: ${r.status}`); }
}

// ─── Work Orders ─────────────────────────────────────────────────────────────

export async function listWorkOrders(params: { status?: string; q?: string; limit?: number; offset?: number } = {}): Promise<{ items: WorkOrder[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("offset", String(params.offset ?? 0));
  const r = await apiFetch(`${SVC}/work-orders?${qs}`);
  if (!r.ok) throw new Error(`listWorkOrders failed: ${r.status}`);
  const body = await r.json();
  return { items: ((body.items ?? []) as Record<string, unknown>[]).map(normWorkOrder), total: body.total ?? 0 };
}

export async function createWorkOrder(input: { code: string; item_id: string; qty: number; due_date?: string; priority?: WOPriority; work_center_id?: string; notes?: string }): Promise<WorkOrder> {
  const r = await apiFetch(`${SVC}/work-orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createWorkOrder failed: ${r.status}`); }
  return normWorkOrder(await r.json());
}

export async function getWorkOrder(id: string): Promise<WorkOrder> {
  const r = await apiFetch(`${SVC}/work-orders/${id}`);
  if (!r.ok) throw new Error(`getWorkOrder failed: ${r.status}`);
  return normWorkOrder(await r.json());
}

export async function updateWorkOrder(id: string, patch: { status?: WOStatus; priority?: WOPriority; due_date?: string | null; notes?: string; work_center_id?: string | null; version: number }): Promise<WorkOrder> {
  const r = await apiFetch(`${SVC}/work-orders/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateWorkOrder failed: ${r.status}`); }
  return normWorkOrder(await r.json());
}

export async function deleteWorkOrder(id: string, version: number): Promise<void> {
  const r = await apiFetch(`${SVC}/work-orders/${id}?version=${version}`, { method: "DELETE", headers: { "X-Confirm-Destructive": "true" } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `deleteWorkOrder failed: ${r.status}`); }
}

export async function releaseWorkOrder(id: string, version: number): Promise<WorkOrder> {
  const r = await apiFetch(`${SVC}/work-orders/${id}/release`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version }) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `releaseWorkOrder failed: ${r.status}`); }
  return normWorkOrder(await r.json());
}

export async function listWoOperations(id: string): Promise<WOOperation[]> {
  const r = await apiFetch(`${SVC}/work-orders/${id}/operations`);
  if (!r.ok) throw new Error(`listWoOperations failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normWOOperation);
}

export async function listWoMaterials(id: string): Promise<WOMaterial[]> {
  const r = await apiFetch(`${SVC}/work-orders/${id}/materials`);
  if (!r.ok) throw new Error(`listWoMaterials failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normWOMaterial);
}

// ─── Lots ─────────────────────────────────────────────────────────────────

export async function createLot(input: { item_id: string; lot_no: string; qty_on_hand: number; status?: LotStatus; source_wo_id?: string }): Promise<Lot> {
  const r = await apiFetch(`${SVC}/lots`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createLot failed: ${r.status}`); }
  return normLot(await r.json());
}

export async function listLotsForItem(itemId: string): Promise<Lot[]> {
  const r = await apiFetch(`${SVC}/items/${itemId}/lots`);
  if (!r.ok) throw new Error(`listLots failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normLot);
}

export async function updateLotStatus(id: string, status: LotStatus): Promise<void> {
  const r = await apiFetch(`${SVC}/lots/${id}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateLotStatus failed: ${r.status}`); }
}

// ─── MRP ─────────────────────────────────────────────────────────────────

export async function createMrpRun(input: { name: string }): Promise<MrpRun> {
  const r = await apiFetch(`${SVC}/mrp/runs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createMrpRun failed: ${r.status}`); }
  return normMrpRun(await r.json());
}

export async function listMrpRuns(params?: { limit?: number }): Promise<MrpRun[]> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  const r = await apiFetch(`${SVC}/mrp/runs?${qs}`);
  if (!r.ok) throw new Error(`listMrpRuns failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normMrpRun);
}

export async function getMrpRun(id: string): Promise<MrpRun> {
  const r = await apiFetch(`${SVC}/mrp/runs/${id}`);
  if (!r.ok) throw new Error(`getMrpRun failed: ${r.status}`);
  const body = await r.json();
  // getMRPRun returns MrpRunSummary: { Run: {...}, Demands: N, Supplies: N, Actions: N }
  const run = (body.Run ?? body.run ?? body) as Record<string, unknown>;
  const normalized = normMrpRun(run);
  normalized.demandCount = Number(body.Demands ?? body.demands ?? body.demand_count ?? normalized.demandCount ?? 0);
  normalized.supplyCount = Number(body.Supplies ?? body.supplies ?? body.supply_count ?? normalized.supplyCount ?? 0);
  normalized.actionCount = Number(body.Actions ?? body.actions ?? body.action_count ?? normalized.actionCount ?? 0);
  return normalized;
}

export async function listMrpDemands(runId: string): Promise<MrpDemand[]> {
  const r = await apiFetch(`${SVC}/mrp/runs/${runId}/demands`);
  if (!r.ok) throw new Error(`listMrpDemands failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normMrpDemand);
}

export async function listMrpSupplies(runId: string): Promise<MrpSupply[]> {
  const r = await apiFetch(`${SVC}/mrp/runs/${runId}/supplies`);
  if (!r.ok) throw new Error(`listMrpSupplies failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normMrpSupply);
}

export async function listMrpActions(runId: string): Promise<MrpAction[]> {
  const r = await apiFetch(`${SVC}/mrp/runs/${runId}/actions`);
  if (!r.ok) throw new Error(`listMrpActions failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normMrpAction);
}

// ─── Lot genealogy / traceability ─────────────────────────────────────────

export interface TraceNode {
  lot_id: string;
  lot_no: string;
  item_id: string;
  item_code: string;
  qty: number;
  status: LotStatus;
  depth: number;
  children?: TraceNode[];
}

export async function traceForLot(
  lotId: string,
  direction: "forward" | "backward" = "forward",
  maxDepth = 10
): Promise<TraceNode> {
  const r = await apiFetch(
    `${SVC}/lots/${lotId}/trace?direction=${direction}&max_depth=${maxDepth}`
  );
  if (!r.ok) throw new Error(`trace failed: ${r.status}`);
  const body = await r.json() as Record<string, unknown>;
  return (body.root ?? body) as TraceNode;
}

export async function linkGenealogyLot(
  childLotId: string,
  parentLotId: string,
  qty: number
): Promise<void> {
  const r = await apiFetch(`${SVC}/lots/${childLotId}/genealogy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ parent_lot_id: parentLotId, qty }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({})) as Record<string, string>;
    throw new Error(e.error ?? `link genealogy failed: ${r.status}`);
  }
}

export async function deleteLot(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/lots/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`delete lot failed: ${r.status}`);
}
