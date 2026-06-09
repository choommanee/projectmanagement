// ─── helpers ───────────────────────────────────────────────────────────────
function g(r: Record<string, unknown>, k: string) {
  return r[k] ?? r[k[0].toUpperCase() + k.slice(1)];
}

function gid(r: Record<string, unknown>, camel: string, snake: string): unknown {
  const goKey = camel
    .replace(/^(.)/, (c) => c.toUpperCase())
    .replace(/Id$/, "ID")
    .replace(/Id([A-Z])/, "ID$1");
  return r[camel] ?? r[snake] ?? r[goKey] ?? r[camel[0].toUpperCase() + camel.slice(1)];
}

const SVC = "/api/quality";

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, opts);
}

// ─── types ─────────────────────────────────────────────────────────────────

export type ApqpPhase = "concept" | "design" | "process" | "validation" | "production" | "feedback";
export type ApqpStatus = "not_started" | "in_progress" | "complete" | "blocked";
export type PpapStatus = "draft" | "submitted" | "approved" | "rejected" | "interim";
export type PpapElementStatus = "not_required" | "in_progress" | "complete" | "not_applicable";
export type FmeaType = "pfmea" | "dfmea";
export type InspectionResult = "pass" | "fail" | "hold";
export type NcrStatus = "open" | "investigating" | "corrected" | "closed";

export interface Milestone {
  name: string;
  due: string;
  done: boolean;
}

export interface ApqpProject {
  id: string;
  itemId: string;
  workOrderId: string | null;
  name: string;
  phase: ApqpPhase;
  status: ApqpStatus;
  milestones: Milestone[];
  ownerId: string;
  targetDate: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface PpapSubmission {
  id: string;
  itemId: string;
  partNo: string;
  customer: string;
  level: number;
  status: PpapStatus;
  submittedAt: string | null;
  decisionAt: string | null;
  notes: string;
  version: number;
}

export interface PpapElement {
  id: string;
  submissionId: string;
  elementNo: number;
  name: string;
  status: PpapElementStatus;
  evidenceUrl: string;
  notes: string;
  updatedAt: string;
}

export interface Fmea {
  id: string;
  type: FmeaType;
  itemId: string;
  name: string;
  team: string[];
  status: string;
  version: number;
}

export interface FmeaMode {
  id: string;
  fmeaId: string;
  function: string;
  failureMode: string;
  effect: string;
  severity: number;
  cause: string;
  occurrence: number;
  detection: number;
  rpn: number;
  actions: string;
  targetDate: string | null;
  sortOrder: number;
}

export interface ControlPlan {
  id: string;
  itemId: string;
  name: string;
  status: string;
  version: number;
  notes: string;
}

export interface ControlPlanChar {
  id: string;
  controlPlanId: string;
  no: number;
  characteristic: string;
  spec: string;
  sampleSize: string;
  sampleFreq: string;
  measurementMethod: string;
  reactionPlan: string;
  sortOrder: number;
}

export interface Inspection {
  id: string;
  workOrderId: string | null;
  itemId: string;
  lotId: string | null;
  inspectedAt: string;
  inspector: string;
  result: InspectionResult;
  measurements: Record<string, unknown>[];
  notes: string;
}

export interface NCR {
  id: string;
  itemId: string;
  lotId: string | null;
  workOrderId: string | null;
  qty: number;
  severity: number;
  description: string;
  status: NcrStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CAPA {
  id: string;
  nonconformanceId: string;
  rootCause: string;
  action: string;
  ownerId: string;
  targetDate: string | null;
  status: string;
  evidence: string;
  createdAt: string;
  updatedAt: string;
}

// ─── normalizers ────────────────────────────────────────────────────────────

function normApqp(r: Record<string, unknown>): ApqpProject {
  const ms = g(r, "milestones") ?? r["Milestones"] ?? [];
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    workOrderId: (gid(r, "workOrderId", "work_order_id") ?? r["WorkOrderID"] ?? null) as string | null,
    name: String(g(r, "name") ?? ""),
    phase: (g(r, "phase") ?? "concept") as ApqpPhase,
    status: (g(r, "status") ?? "not_started") as ApqpStatus,
    milestones: Array.isArray(ms) ? (ms as Record<string, unknown>[]).map(m => ({
      name: String(m.name ?? m.Name ?? ""),
      due: String(m.due ?? m.Due ?? ""),
      done: Boolean(m.done ?? m.Done ?? false),
    })) : [],
    ownerId: String(gid(r, "ownerId", "owner_id") ?? r["OwnerID"] ?? ""),
    targetDate: (gid(r, "targetDate", "target_date") ?? r["TargetDate"] ?? null) as string | null,
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
    version: Number(g(r, "version") ?? 1),
  };
}

function normPpap(r: Record<string, unknown>): PpapSubmission {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    partNo: String(gid(r, "partNo", "part_no") ?? r["PartNo"] ?? ""),
    customer: String(g(r, "customer") ?? ""),
    level: Number(g(r, "level") ?? 1),
    status: (g(r, "status") ?? "draft") as PpapStatus,
    submittedAt: (gid(r, "submittedAt", "submitted_at") ?? r["SubmittedAt"] ?? null) as string | null,
    decisionAt: (gid(r, "decisionAt", "decision_at") ?? r["DecisionAt"] ?? null) as string | null,
    notes: String(g(r, "notes") ?? ""),
    version: Number(g(r, "version") ?? 1),
  };
}

function normPpapElement(r: Record<string, unknown>): PpapElement {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    submissionId: String(gid(r, "submissionId", "submission_id") ?? r["SubmissionID"] ?? ""),
    elementNo: Number(gid(r, "elementNo", "element_no") ?? r["ElementNo"] ?? 0),
    name: String(g(r, "name") ?? ""),
    status: (g(r, "status") ?? "not_required") as PpapElementStatus,
    evidenceUrl: String(gid(r, "evidenceUrl", "evidence_url") ?? r["EvidenceURL"] ?? r["EvidenceUrl"] ?? ""),
    notes: String(g(r, "notes") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

function normFmea(r: Record<string, unknown>): Fmea {
  const team = g(r, "team") ?? r["Team"] ?? [];
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    type: (g(r, "type") ?? "pfmea") as FmeaType,
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    name: String(g(r, "name") ?? ""),
    team: Array.isArray(team) ? (team as string[]) : (typeof team === "string" && team ? team.split(",").map(s => s.trim()) : []),
    status: String(g(r, "status") ?? "draft"),
    version: Number(g(r, "version") ?? 1),
  };
}

function normFmeaMode(r: Record<string, unknown>): FmeaMode {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    fmeaId: String(gid(r, "fmeaId", "fmea_id") ?? r["FmeaID"] ?? r["FMEAID"] ?? ""),
    function: String(g(r, "function") ?? r["Function"] ?? ""),
    failureMode: String(gid(r, "failureMode", "failure_mode") ?? r["FailureMode"] ?? ""),
    effect: String(g(r, "effect") ?? ""),
    severity: Number(g(r, "severity") ?? 1),
    cause: String(g(r, "cause") ?? ""),
    occurrence: Number(g(r, "occurrence") ?? 1),
    detection: Number(g(r, "detection") ?? 1),
    rpn: Number(g(r, "rpn") ?? r["RPN"] ?? 0),
    actions: String(g(r, "actions") ?? ""),
    targetDate: (gid(r, "targetDate", "target_date") ?? r["TargetDate"] ?? null) as string | null,
    sortOrder: Number(gid(r, "sortOrder", "sort_order") ?? r["SortOrder"] ?? 0),
  };
}

function normControlPlan(r: Record<string, unknown>): ControlPlan {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    name: String(g(r, "name") ?? ""),
    status: String(g(r, "status") ?? "draft"),
    version: Number(g(r, "version") ?? 1),
    notes: String(g(r, "notes") ?? ""),
  };
}

function normControlPlanChar(r: Record<string, unknown>): ControlPlanChar {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    controlPlanId: String(gid(r, "controlPlanId", "control_plan_id") ?? r["ControlPlanID"] ?? ""),
    no: Number(g(r, "no") ?? r["No"] ?? 0),
    characteristic: String(g(r, "characteristic") ?? ""),
    spec: String(g(r, "spec") ?? ""),
    sampleSize: String(gid(r, "sampleSize", "sample_size") ?? r["SampleSize"] ?? ""),
    sampleFreq: String(gid(r, "sampleFreq", "sample_freq") ?? r["SampleFreq"] ?? ""),
    measurementMethod: String(gid(r, "measurementMethod", "measurement_method") ?? r["MeasurementMethod"] ?? ""),
    reactionPlan: String(gid(r, "reactionPlan", "reaction_plan") ?? r["ReactionPlan"] ?? ""),
    sortOrder: Number(gid(r, "sortOrder", "sort_order") ?? r["SortOrder"] ?? 0),
  };
}

function normInspection(r: Record<string, unknown>): Inspection {
  const meas = g(r, "measurements") ?? r["Measurements"] ?? [];
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    workOrderId: (gid(r, "workOrderId", "work_order_id") ?? r["WorkOrderID"] ?? null) as string | null,
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    lotId: (gid(r, "lotId", "lot_id") ?? r["LotID"] ?? null) as string | null,
    inspectedAt: String(gid(r, "inspectedAt", "inspected_at") ?? r["InspectedAt"] ?? ""),
    inspector: String(g(r, "inspector") ?? ""),
    result: (g(r, "result") ?? "pass") as InspectionResult,
    measurements: Array.isArray(meas) ? (meas as Record<string, unknown>[]) : [],
    notes: String(g(r, "notes") ?? ""),
  };
}

function normNCR(r: Record<string, unknown>): NCR {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    itemId: String(gid(r, "itemId", "item_id") ?? r["ItemID"] ?? ""),
    lotId: (gid(r, "lotId", "lot_id") ?? r["LotID"] ?? null) as string | null,
    workOrderId: (gid(r, "workOrderId", "work_order_id") ?? r["WorkOrderID"] ?? null) as string | null,
    qty: Number(g(r, "qty") ?? 0),
    severity: Number(g(r, "severity") ?? 1),
    description: String(g(r, "description") ?? ""),
    status: (g(r, "status") ?? "open") as NcrStatus,
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
    version: Number(g(r, "version") ?? 1),
  };
}

function normCAPA(r: Record<string, unknown>): CAPA {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    nonconformanceId: String(gid(r, "nonconformanceId", "nonconformance_id") ?? r["NonconformanceID"] ?? ""),
    rootCause: String(gid(r, "rootCause", "root_cause") ?? r["RootCause"] ?? ""),
    action: String(g(r, "action") ?? ""),
    ownerId: String(gid(r, "ownerId", "owner_id") ?? r["OwnerID"] ?? ""),
    targetDate: (gid(r, "targetDate", "target_date") ?? r["TargetDate"] ?? null) as string | null,
    status: String(g(r, "status") ?? "open"),
    evidence: String(g(r, "evidence") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

// ─── APQP ───────────────────────────────────────────────────────────────────

export async function listApqp(): Promise<ApqpProject[]> {
  const r = await apiFetch(`${SVC}/apqp`);
  if (!r.ok) throw new Error(`listApqp failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normApqp);
}

export async function createApqp(input: {
  item_id: string;
  name: string;
  phase?: ApqpPhase;
  owner_id?: string;
  target_date?: string;
  work_order_id?: string;
}): Promise<ApqpProject> {
  const r = await apiFetch(`${SVC}/apqp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `createApqp failed: ${r.status}`);
  }
  return normApqp(await r.json());
}

export async function getApqp(id: string): Promise<ApqpProject> {
  const r = await apiFetch(`${SVC}/apqp/${id}`);
  if (!r.ok) throw new Error(`getApqp failed: ${r.status}`);
  return normApqp(await r.json());
}

export async function updateApqp(id: string, patch: {
  name?: string;
  phase?: ApqpPhase;
  status?: ApqpStatus;
  owner_id?: string;
  target_date?: string | null;
  milestones?: Milestone[];
  version: number;
}): Promise<ApqpProject> {
  const r = await apiFetch(`${SVC}/apqp/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `updateApqp failed: ${r.status}`);
  }
  return normApqp(await r.json());
}

export async function deleteApqp(id: string, version: number): Promise<void> {
  const r = await apiFetch(`${SVC}/apqp/${id}?version=${version}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `deleteApqp failed: ${r.status}`);
  }
}

// ─── PPAP ───────────────────────────────────────────────────────────────────

export async function listPpap(): Promise<PpapSubmission[]> {
  const r = await apiFetch(`${SVC}/ppap`);
  if (!r.ok) throw new Error(`listPpap failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normPpap);
}

export async function createPpap(input: {
  item_id: string;
  part_no: string;
  customer: string;
  level: number;
  notes?: string;
}): Promise<PpapSubmission> {
  const r = await apiFetch(`${SVC}/ppap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `createPpap failed: ${r.status}`);
  }
  return normPpap(await r.json());
}

export async function getPpap(id: string): Promise<PpapSubmission> {
  const r = await apiFetch(`${SVC}/ppap/${id}`);
  if (!r.ok) throw new Error(`getPpap failed: ${r.status}`);
  return normPpap(await r.json());
}

export async function updatePpap(id: string, patch: {
  status?: PpapStatus;
  notes?: string;
  version: number;
}): Promise<PpapSubmission> {
  const r = await apiFetch(`${SVC}/ppap/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `updatePpap failed: ${r.status}`);
  }
  return normPpap(await r.json());
}

export async function listPpapElements(submissionId: string): Promise<PpapElement[]> {
  const r = await apiFetch(`${SVC}/ppap/${submissionId}/elements`);
  if (!r.ok) throw new Error(`listPpapElements failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normPpapElement);
}

export async function patchPpapElement(id: string, patch: {
  status?: PpapElementStatus;
  evidence_url?: string;
  notes?: string;
}): Promise<PpapElement> {
  const r = await apiFetch(`${SVC}/ppap-elements/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `patchPpapElement failed: ${r.status}`);
  }
  return normPpapElement(await r.json());
}

// ─── FMEA ───────────────────────────────────────────────────────────────────

export async function listFmea(): Promise<Fmea[]> {
  const r = await apiFetch(`${SVC}/fmea`);
  if (!r.ok) throw new Error(`listFmea failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normFmea);
}

export async function createFmea(input: {
  type: FmeaType;
  item_id: string;
  name: string;
  team?: string[];
}): Promise<Fmea> {
  const r = await apiFetch(`${SVC}/fmea`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `createFmea failed: ${r.status}`);
  }
  return normFmea(await r.json());
}

export async function getFmea(id: string): Promise<Fmea> {
  const r = await apiFetch(`${SVC}/fmea/${id}`);
  if (!r.ok) throw new Error(`getFmea failed: ${r.status}`);
  return normFmea(await r.json());
}

export async function updateFmea(id: string, patch: {
  name?: string;
  team?: string[];
  status?: string;
  version: number;
}): Promise<Fmea> {
  const r = await apiFetch(`${SVC}/fmea/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `updateFmea failed: ${r.status}`);
  }
  return normFmea(await r.json());
}

export async function listFmeaModes(fmeaId: string): Promise<FmeaMode[]> {
  const r = await apiFetch(`${SVC}/fmea/${fmeaId}/modes`);
  if (!r.ok) throw new Error(`listFmeaModes failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normFmeaMode);
}

export async function addFmeaMode(fmeaId: string, mode: {
  function: string;
  failure_mode: string;
  effect?: string;
  severity?: number;
  cause?: string;
  occurrence?: number;
  detection?: number;
  actions?: string;
  target_date?: string;
  sort_order?: number;
}): Promise<FmeaMode> {
  const r = await apiFetch(`${SVC}/fmea/${fmeaId}/modes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(mode),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `addFmeaMode failed: ${r.status}`);
  }
  return normFmeaMode(await r.json());
}

export async function updateFmeaMode(id: string, patch: {
  function?: string;
  failure_mode?: string;
  effect?: string;
  severity?: number;
  cause?: string;
  occurrence?: number;
  detection?: number;
  actions?: string;
  target_date?: string | null;
  sort_order?: number;
}): Promise<FmeaMode> {
  const r = await apiFetch(`${SVC}/fmea-modes/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `updateFmeaMode failed: ${r.status}`);
  }
  return normFmeaMode(await r.json());
}

export async function deleteFmeaMode(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/fmea-modes/${id}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `deleteFmeaMode failed: ${r.status}`);
  }
}

// ─── Control Plans ──────────────────────────────────────────────────────────

export async function listControlPlans(): Promise<ControlPlan[]> {
  const r = await apiFetch(`${SVC}/control-plans`);
  if (!r.ok) throw new Error(`listControlPlans failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normControlPlan);
}

export async function createControlPlan(input: {
  item_id: string;
  name: string;
  notes?: string;
}): Promise<ControlPlan> {
  const r = await apiFetch(`${SVC}/control-plans`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `createControlPlan failed: ${r.status}`);
  }
  return normControlPlan(await r.json());
}

export async function getControlPlan(id: string): Promise<ControlPlan> {
  const r = await apiFetch(`${SVC}/control-plans/${id}`);
  if (!r.ok) throw new Error(`getControlPlan failed: ${r.status}`);
  return normControlPlan(await r.json());
}

export async function updateControlPlan(id: string, patch: {
  name?: string;
  status?: string;
  notes?: string;
}): Promise<ControlPlan> {
  const r = await apiFetch(`${SVC}/control-plans/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `updateControlPlan failed: ${r.status}`);
  }
  return normControlPlan(await r.json());
}

export async function listControlPlanChars(controlPlanId: string): Promise<ControlPlanChar[]> {
  const r = await apiFetch(`${SVC}/control-plans/${controlPlanId}/characteristics`);
  if (!r.ok) throw new Error(`listControlPlanChars failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normControlPlanChar);
}

export async function addControlPlanChar(controlPlanId: string, char: {
  no: number;
  characteristic: string;
  spec?: string;
  sample_size?: string;
  sample_freq?: string;
  measurement_method?: string;
  reaction_plan?: string;
  sort_order?: number;
}): Promise<ControlPlanChar> {
  const r = await apiFetch(`${SVC}/control-plans/${controlPlanId}/characteristics`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(char),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `addControlPlanChar failed: ${r.status}`);
  }
  return normControlPlanChar(await r.json());
}

export async function updateControlPlanChar(id: string, patch: {
  characteristic?: string;
  spec?: string;
  sample_size?: string;
  sample_freq?: string;
  measurement_method?: string;
  reaction_plan?: string;
  sort_order?: number;
}): Promise<ControlPlanChar> {
  const r = await apiFetch(`${SVC}/control-plan-chars/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `updateControlPlanChar failed: ${r.status}`);
  }
  return normControlPlanChar(await r.json());
}

export async function deleteControlPlanChar(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/control-plan-chars/${id}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `deleteControlPlanChar failed: ${r.status}`);
  }
}

// ─── Inspections ─────────────────────────────────────────────────────────────

export async function listInspections(params: { result?: string; item_id?: string; limit?: number } = {}): Promise<Inspection[]> {
  const qs = new URLSearchParams();
  if (params.result) qs.set("result", params.result);
  if (params.item_id) qs.set("item_id", params.item_id);
  qs.set("limit", String(params.limit ?? 100));
  const r = await apiFetch(`${SVC}/inspections?${qs}`);
  if (!r.ok) throw new Error(`listInspections failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normInspection);
}

export async function createInspection(input: {
  item_id: string;
  inspector: string;
  result: InspectionResult;
  work_order_id?: string;
  lot_id?: string;
  measurements?: Record<string, unknown>[];
  notes?: string;
}): Promise<Inspection> {
  const r = await apiFetch(`${SVC}/inspections`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, inspected_at: new Date().toISOString() }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `createInspection failed: ${r.status}`);
  }
  return normInspection(await r.json());
}

export async function getInspection(id: string): Promise<Inspection> {
  const r = await apiFetch(`${SVC}/inspections/${id}`);
  if (!r.ok) throw new Error(`getInspection failed: ${r.status}`);
  return normInspection(await r.json());
}

// ─── NCR ─────────────────────────────────────────────────────────────────────

export async function listNCRs(params: { status?: string; limit?: number } = {}): Promise<NCR[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  qs.set("limit", String(params.limit ?? 100));
  const r = await apiFetch(`${SVC}/ncrs?${qs}`);
  if (!r.ok) throw new Error(`listNCRs failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normNCR);
}

export async function createNCR(input: {
  item_id: string;
  qty: number;
  severity: number;
  description: string;
  lot_id?: string;
  work_order_id?: string;
}): Promise<NCR> {
  const r = await apiFetch(`${SVC}/ncrs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `createNCR failed: ${r.status}`);
  }
  return normNCR(await r.json());
}

export async function getNCR(id: string): Promise<NCR> {
  const r = await apiFetch(`${SVC}/ncrs/${id}`);
  if (!r.ok) throw new Error(`getNCR failed: ${r.status}`);
  return normNCR(await r.json());
}

export async function updateNCR(id: string, patch: {
  status?: NcrStatus;
  severity?: number;
  description?: string;
  qty?: number;
  version: number;
}): Promise<NCR> {
  const r = await apiFetch(`${SVC}/ncrs/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `updateNCR failed: ${r.status}`);
  }
  return normNCR(await r.json());
}

// ─── CAPA ─────────────────────────────────────────────────────────────────────

export async function getCAPA(ncrId: string): Promise<CAPA | null> {
  const r = await apiFetch(`${SVC}/ncrs/${ncrId}/capa`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`getCAPA failed: ${r.status}`);
  const body = await r.json();
  if (!body) return null;
  // Backend returns {items:[...],total}. CAPA is 1-per-NCR in the UI, so take
  // the first item. Fall back to a bare object for older/alternate shapes.
  const row = Array.isArray(body.items)
    ? (body.items[0] as Record<string, unknown> | undefined)
    : (body.id || body.ID ? (body as Record<string, unknown>) : undefined);
  if (!row || (!row.id && !row.ID)) return null;
  return normCAPA(row);
}

export async function attachCAPA(ncrId: string, input: {
  root_cause: string;
  action: string;
  owner_id?: string;
  target_date?: string;
}): Promise<CAPA> {
  const r = await apiFetch(`${SVC}/ncrs/${ncrId}/capa`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `attachCAPA failed: ${r.status}`);
  }
  return normCAPA(await r.json());
}

export async function updateCAPA(id: string, patch: {
  root_cause?: string;
  action?: string;
  status?: string;
  target_date?: string | null;
  evidence?: string;
  owner_id?: string;
}): Promise<CAPA> {
  const r = await apiFetch(`${SVC}/capa/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `updateCAPA failed: ${r.status}`);
  }
  return normCAPA(await r.json());
}
