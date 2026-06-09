// ─── helpers ───────────────────────────────────────────────────────────────
function g(r: Record<string, unknown>, k: string): unknown {
  return r[k] ?? r[k[0].toUpperCase() + k.slice(1)];
}

function gid(r: Record<string, unknown>, camel: string, snake: string): unknown {
  const goKey = camel
    .replace(/^(.)/, (c) => c.toUpperCase())
    .replace(/Id$/, "ID")
    .replace(/Id([A-Z])/, "ID$1");
  return r[camel] ?? r[snake] ?? r[goKey] ?? r[camel[0].toUpperCase() + camel.slice(1)];
}

const SVC = "/api/workflows";

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, opts);
}

// ─── types ─────────────────────────────────────────────────────────────────

export type WorkflowStatus = "draft" | "published" | "archived";
export type InstanceStatus = "running" | "paused" | "completed" | "failed" | "cancelled";
export type StepStatus = "running" | "completed" | "failed" | "skipped";

export interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  trigger: { type: string } | null;
  status: WorkflowStatus;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface WorkflowVersion {
  id: string;
  definitionId: string;
  rev: number;
  dsl: DSL;
  publishedAt: string | null;
  createdBy: string;
  notes: string;
  createdAt: string;
}

export interface StepExecution {
  id: string;
  instanceId: string;
  stepId: string;
  stepType: string;
  status: StepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface HumanTask {
  id: string;
  instanceId: string;
  stepId: string;
  assigneeId: string | null;
  form: Record<string, unknown>;
  data: Record<string, unknown> | null;
  outcome: string | null;
  slaDeadline: string | null;
  escalateTo: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface WorkflowInstance {
  id: string;
  definitionId: string;
  versionId: string;
  status: InstanceStatus;
  input: unknown;
  output: unknown;
  variables: Record<string, unknown>;
  cursor: string | null;
  error: string | null;
  triggerKind: string;
  startedAt: string | null;
  endedAt: string | null;
  /** When the instance is paused on a timer, the wall-clock time it will resume. */
  wakeAt: string | null;
  /**
   * When the instance is paused awaiting an e-signature (cursor on a
   * `request_signature` step), the id of the signature envelope to sign.
   */
  pendingEnvelopeId: string | null;
}

export interface InstanceDetail extends WorkflowInstance {
  steps: StepExecution[];
  human_tasks: HumanTask[];
}

export interface DslStep {
  id: string;
  type: string;
  [k: string]: unknown;
}

export interface DSL {
  id: string;
  trigger?: { type: string };
  input_schema?: unknown;
  variables?: Record<string, unknown>;
  steps: DslStep[];
}

// ─── normalizers ─────────────────────────────────────────────────────────────

export function normWorkflowDef(raw: Record<string, unknown>): WorkflowDef {
  return {
    id: String(raw["id"] ?? raw["ID"] ?? ""),
    name: String(g(raw, "name") ?? ""),
    description: String(g(raw, "description") ?? ""),
    trigger: (g(raw, "trigger") ?? null) as { type: string } | null,
    status: (g(raw, "status") ?? "draft") as WorkflowStatus,
    currentVersion: Number(raw["current_version"] ?? raw["CurrentVersion"] ?? g(raw, "currentVersion") ?? 0),
    createdAt: String(g(raw, "createdAt") ?? raw["CreatedAt"] ?? ""),
    updatedAt: String(g(raw, "updatedAt") ?? raw["UpdatedAt"] ?? ""),
    version: Number(g(raw, "version") ?? 1),
  };
}

export function normWorkflowVersion(raw: Record<string, unknown>): WorkflowVersion {
  return {
    id: String(raw["id"] ?? raw["ID"] ?? ""),
    definitionId: String(gid(raw, "definitionId", "definition_id") ?? ""),
    rev: Number(g(raw, "rev") ?? 0),
    dsl: (g(raw, "dsl") ?? { id: "", steps: [] }) as DSL,
    publishedAt: (g(raw, "publishedAt") ?? raw["PublishedAt"] ?? raw["published_at"] ?? null) as string | null,
    createdBy: String(gid(raw, "createdBy", "created_by") ?? ""),
    notes: String(g(raw, "notes") ?? ""),
    createdAt: String(g(raw, "createdAt") ?? raw["CreatedAt"] ?? ""),
  };
}

export function normStepExecution(raw: Record<string, unknown>): StepExecution {
  return {
    id: String(raw["id"] ?? raw["ID"] ?? ""),
    instanceId: String(gid(raw, "instanceId", "instance_id") ?? ""),
    stepId: String(raw["step_id"] ?? raw["StepID"] ?? gid(raw, "stepId", "step_id") ?? ""),
    stepType: String(raw["step_type"] ?? raw["StepType"] ?? g(raw, "stepType") ?? ""),
    status: (g(raw, "status") ?? "skipped") as StepStatus,
    input: g(raw, "input") ?? null,
    output: g(raw, "output") ?? null,
    error: (g(raw, "error") ?? null) as string | null,
    startedAt: (g(raw, "startedAt") ?? raw["StartedAt"] ?? raw["started_at"] ?? null) as string | null,
    endedAt: (g(raw, "endedAt") ?? raw["EndedAt"] ?? raw["ended_at"] ?? null) as string | null,
  };
}

export function normHumanTask(raw: Record<string, unknown>): HumanTask {
  return {
    id: String(raw["id"] ?? raw["ID"] ?? ""),
    instanceId: String(gid(raw, "instanceId", "instance_id") ?? ""),
    stepId: String(raw["step_id"] ?? raw["StepID"] ?? gid(raw, "stepId", "step_id") ?? ""),
    assigneeId: (gid(raw, "assigneeId", "assignee_id") ?? null) as string | null,
    form: (g(raw, "form") ?? {}) as Record<string, unknown>,
    data: (g(raw, "data") ?? null) as Record<string, unknown> | null,
    outcome: (g(raw, "outcome") ?? null) as string | null,
    slaDeadline: (raw["sla_deadline"] ?? raw["SlaDeadline"] ?? raw["SLADeadline"] ?? g(raw, "slaDeadline") ?? null) as string | null,
    escalateTo: (raw["escalate_to"] ?? raw["EscalateTo"] ?? g(raw, "escalateTo") ?? null) as string | null,
    createdAt: String(g(raw, "createdAt") ?? raw["CreatedAt"] ?? ""),
    completedAt: (g(raw, "completedAt") ?? raw["CompletedAt"] ?? raw["completed_at"] ?? null) as string | null,
  };
}

export function normInstance(raw: Record<string, unknown>): WorkflowInstance {
  return {
    id: String(raw["id"] ?? raw["ID"] ?? ""),
    definitionId: String(gid(raw, "definitionId", "definition_id") ?? ""),
    versionId: String(gid(raw, "versionId", "version_id") ?? ""),
    status: (g(raw, "status") ?? "running") as InstanceStatus,
    input: g(raw, "input") ?? null,
    output: g(raw, "output") ?? null,
    variables: (g(raw, "variables") ?? {}) as Record<string, unknown>,
    cursor: (g(raw, "cursor") ?? null) as string | null,
    error: (g(raw, "error") ?? null) as string | null,
    triggerKind: String(raw["trigger_kind"] ?? raw["TriggerKind"] ?? g(raw, "triggerKind") ?? ""),
    startedAt: (g(raw, "startedAt") ?? raw["StartedAt"] ?? raw["started_at"] ?? null) as string | null,
    endedAt: (g(raw, "endedAt") ?? raw["EndedAt"] ?? raw["ended_at"] ?? null) as string | null,
    wakeAt: (raw["wake_at"] ?? raw["WakeAt"] ?? g(raw, "wakeAt") ?? null) as string | null,
    pendingEnvelopeId: (raw["pending_envelope_id"] ?? raw["PendingEnvelopeID"] ?? g(raw, "pendingEnvelopeId") ?? null) as string | null,
  };
}

export function normInstanceDetail(raw: Record<string, unknown>): InstanceDetail {
  const base = normInstance(raw);
  const stepsRaw = (raw["steps"] ?? raw["Steps"] ?? []) as Record<string, unknown>[];
  const htRaw = (raw["human_tasks"] ?? raw["HumanTasks"] ?? []) as Record<string, unknown>[];
  return {
    ...base,
    steps: Array.isArray(stepsRaw) ? stepsRaw.map(normStepExecution) : [],
    human_tasks: Array.isArray(htRaw) ? htRaw.map(normHumanTask) : [],
  };
}

// ─── Workflow definitions ───────────────────────────────────────────────────

export async function listWorkflows(params?: {
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: WorkflowDef[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.q) qs.set("q", params.q);
  if (params?.status) qs.set("status", params.status);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const r = await apiFetch(`${SVC}/workflows?${qs}`);
  if (!r.ok) throw new Error(`listWorkflows failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body.workflows ?? body ?? []) as Record<string, unknown>[];
  return {
    items: Array.isArray(arr) ? arr.map(normWorkflowDef) : [],
    total: Number(body.total ?? body.Total ?? arr.length),
  };
}

export async function getWorkflow(id: string): Promise<WorkflowDef> {
  const r = await apiFetch(`${SVC}/workflows/${id}`);
  if (!r.ok) throw new Error(`getWorkflow failed: ${r.status}`);
  return normWorkflowDef(await r.json());
}

export async function createWorkflow(input: {
  name: string;
  description?: string;
  trigger?: { type: string };
}): Promise<WorkflowDef> {
  const r = await apiFetch(`${SVC}/workflows`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `createWorkflow failed: ${r.status}`);
  }
  return normWorkflowDef(await r.json());
}

export async function patchWorkflow(
  id: string,
  patch: { name?: string; description?: string; trigger?: unknown; status?: string; version: number }
): Promise<WorkflowDef> {
  const r = await apiFetch(`${SVC}/workflows/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `patchWorkflow failed: ${r.status}`);
  }
  return normWorkflowDef(await r.json());
}

export async function deleteWorkflow(id: string, version: number): Promise<void> {
  const r = await apiFetch(`${SVC}/workflows/${id}?version=${version}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `deleteWorkflow failed: ${r.status}`);
  }
}

// ─── Versions ─────────────────────────────────────────────────────────────

export async function listVersions(workflowId: string): Promise<WorkflowVersion[]> {
  const r = await apiFetch(`${SVC}/workflows/${workflowId}/versions`);
  if (!r.ok) throw new Error(`listVersions failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body.versions ?? body ?? []) as Record<string, unknown>[];
  return Array.isArray(arr) ? arr.map(normWorkflowVersion) : [];
}

export async function getVersion(id: string): Promise<WorkflowVersion> {
  const r = await apiFetch(`${SVC}/workflow-versions/${id}`);
  if (!r.ok) throw new Error(`getVersion failed: ${r.status}`);
  return normWorkflowVersion(await r.json());
}

export async function saveVersion(
  workflowId: string,
  input: { dsl: DSL; notes?: string }
): Promise<WorkflowVersion> {
  const r = await apiFetch(`${SVC}/workflows/${workflowId}/versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `saveVersion failed: ${r.status}`);
  }
  return normWorkflowVersion(await r.json());
}

export async function publishVersion(
  workflowId: string,
  input: { rev: number; version: number }
): Promise<WorkflowDef> {
  const r = await apiFetch(`${SVC}/workflows/${workflowId}/publish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `publishVersion failed: ${r.status}`);
  }
  return normWorkflowDef(await r.json());
}

// ─── Instances ────────────────────────────────────────────────────────────

export async function listInstances(
  workflowId: string,
  params?: { status?: string; limit?: number; offset?: number }
): Promise<{ items: WorkflowInstance[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const r = await apiFetch(`${SVC}/workflows/${workflowId}/instances?${qs}`);
  if (!r.ok) throw new Error(`listInstances failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body.instances ?? body ?? []) as Record<string, unknown>[];
  return {
    items: Array.isArray(arr) ? arr.map(normInstance) : [],
    total: Number(body.total ?? body.Total ?? arr.length),
  };
}

export async function startInstance(
  workflowId: string,
  input: { input?: unknown }
): Promise<WorkflowInstance> {
  const r = await apiFetch(`${SVC}/workflows/${workflowId}/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `startInstance failed: ${r.status}`);
  }
  const body = await r.json() as Record<string, unknown>;
  // Backend returns { instance: {...}, steps: [...] } envelope
  const raw = (body.instance ?? body) as Record<string, unknown>;
  return normInstance(raw);
}

export async function getInstance(id: string): Promise<InstanceDetail> {
  const r = await apiFetch(`${SVC}/instances/${id}`);
  if (!r.ok) throw new Error(`getInstance failed: ${r.status}`);
  const body = await r.json() as Record<string, unknown>;
  // Backend returns { instance: {...}, steps: [...], human_tasks: [...] } envelope
  const instRaw = (body.instance ?? body) as Record<string, unknown>;
  const stepsRaw = (body.steps ?? body.Steps ?? instRaw.steps ?? []) as Record<string, unknown>[];
  const htRaw = (body.human_tasks ?? body.HumanTasks ?? instRaw.human_tasks ?? []) as Record<string, unknown>[];
  return {
    ...normInstance(instRaw),
    steps: Array.isArray(stepsRaw) ? stepsRaw.map(normStepExecution) : [],
    human_tasks: Array.isArray(htRaw) ? htRaw.map(normHumanTask) : [],
  };
}

export async function resumeInstance(
  id: string,
  input: { input?: unknown }
): Promise<WorkflowInstance> {
  const r = await apiFetch(`${SVC}/instances/${id}/resume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `resumeInstance failed: ${r.status}`);
  }
  return normInstance(await r.json());
}

export async function listAllInstances(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: WorkflowInstance[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const r = await apiFetch(`${SVC}/instances?${qs}`);
  if (!r.ok) throw new Error(`listAllInstances failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body.instances ?? body ?? []) as Record<string, unknown>[];
  return {
    items: Array.isArray(arr) ? arr.map(normInstance) : [],
    total: Number(body.total ?? body.Total ?? arr.length),
  };
}

// ─── Workflow Templates ────────────────────────────────────────────────────

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  definition: Record<string, unknown>;
  isSystem: boolean;
  createdAt: string;
}

export async function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  const r = await apiFetch(`${SVC}/workflow-templates`);
  if (!r.ok) return [];
  const body = await r.json();
  return (body.items as WorkflowTemplate[] | null) ?? [];
}

export async function createWorkflowFromTemplate(templateId: string, name: string): Promise<WorkflowDef> {
  const r = await apiFetch(`${SVC}/workflow-templates/${templateId}/use`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) throw new Error(`create from template failed: ${r.status}`);
  const body = await r.json() as Record<string, unknown>;
  // Backend returns { workflow: {...}, version: {...} }
  const wfRaw = (body["workflow"] ?? body) as Record<string, unknown>;
  return normWorkflowDef(wfRaw);
}

/** Canonical name of the seeded "Document Approval (Project)" workflow/template. */
export const DOC_APPROVAL_WORKFLOW_NAME = "Document Approval (Project)";

/**
 * Find-or-create-and-publish the Document Approval workflow for this tenant, then
 * return a *published* workflow id ready to start.
 *
 * 1. GET workflows → if one named "Document Approval (Project)" already exists, use it.
 *    - if it's not yet published, publish its latest draft.
 * 2. else create one from the seeded system template (createWorkflowFromTemplate),
 *    then publish its first version.
 */
export async function ensureDocApprovalWorkflow(): Promise<WorkflowDef> {
  // 1. Look for an existing definition by name.
  const { items } = await listWorkflows({ q: DOC_APPROVAL_WORKFLOW_NAME, limit: 50 });
  let def =
    items.find((w) => w.name === DOC_APPROVAL_WORKFLOW_NAME) ??
    items.find((w) => w.name.toLowerCase().includes("document approval"));

  // 2. Create from template if missing.
  if (!def) {
    const templates = await listWorkflowTemplates();
    const tpl =
      templates.find((t) => t.name === DOC_APPROVAL_WORKFLOW_NAME) ??
      templates.find((t) => t.name.toLowerCase().includes("document approval"));
    if (!tpl) throw new Error(`Seeded template "${DOC_APPROVAL_WORKFLOW_NAME}" not found`);
    def = await createWorkflowFromTemplate(tpl.id, DOC_APPROVAL_WORKFLOW_NAME);
  }

  // 3. Ensure it is published.
  if (def.status !== "published") {
    const versions = await listVersions(def.id);
    if (versions.length > 0) {
      // Publish the highest rev (latest authored version).
      const latest = [...versions].sort((a, b) => b.rev - a.rev)[0];
      def = await publishVersion(def.id, { rev: latest.rev, version: def.version });
    }
  }

  return def;
}

/**
 * Retry a FAILED instance — re-runs from its cursor. Backend returns 409 if the
 * instance is not in `failed` status. Available only when `status === "failed"`.
 */
export async function retryInstance(id: string): Promise<WorkflowInstance> {
  const r = await apiFetch(`${SVC}/instances/${id}/retry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `retryInstance failed: ${r.status}`);
  }
  const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = (body.instance ?? body) as Record<string, unknown>;
  return normInstance(raw);
}

export async function cancelInstance(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/instances/${id}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `cancelInstance failed: ${r.status}`);
  }
}

// ─── Human Tasks ──────────────────────────────────────────────────────────

export async function listHumanTasks(params?: {
  assignee_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: HumanTask[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.assignee_id) qs.set("assignee_id", params.assignee_id);
  if (params?.status) qs.set("status", params.status);
  if (params?.limit != null) qs.set("limit", String(params.limit));
  if (params?.offset != null) qs.set("offset", String(params.offset));
  const r = await apiFetch(`${SVC}/human-tasks?${qs}`);
  if (!r.ok) throw new Error(`listHumanTasks failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body.tasks ?? body ?? []) as Record<string, unknown>[];
  return {
    items: Array.isArray(arr) ? arr.map(normHumanTask) : [],
    total: Number(body.total ?? body.Total ?? arr.length),
  };
}

export async function listInstanceHumanTasks(instanceId: string): Promise<HumanTask[]> {
  const r = await apiFetch(`${SVC}/instances/${instanceId}/human-tasks`);
  if (!r.ok) throw new Error(`listInstanceHumanTasks failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body.tasks ?? body ?? []) as Record<string, unknown>[];
  return Array.isArray(arr) ? arr.map(normHumanTask) : [];
}

export async function completeHumanTask(
  id: string,
  input: { outcome: string; data?: Record<string, unknown> }
): Promise<WorkflowInstance | null> {
  const r = await apiFetch(`${SVC}/human-tasks/${id}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as Record<string, string>).error ?? `completeHumanTask failed: ${r.status}`);
  }
  // Returns the resumed-instance envelope { instance, steps, ... }; tolerate empty body.
  const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return null;
  const raw = (body.instance ?? body) as Record<string, unknown>;
  return raw && Object.keys(raw).length ? normInstance(raw) : null;
}

// ─── Human-task form schema ──────────────────────────────────────────────────
// `form` is freeform author JSON. The common authored shape is:
//   { prompt, fields: [{ name, label, type, required, options? }], outcomes?: [...] }
// Parse defensively — callers fall back to a raw JSON editor when this returns null.

export type HumanFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "checkbox"
  | "date";

export interface HumanFormField {
  name: string;
  label: string;
  type: HumanFieldType;
  required: boolean;
  options: { label: string; value: string }[];
  placeholder?: string;
}

export interface HumanFormSchema {
  prompt: string | null;
  fields: HumanFormField[];
  /** Author-declared outcomes; empty → caller defaults to approve/reject. */
  outcomes: string[];
}

const KNOWN_FIELD_TYPES: HumanFieldType[] = [
  "text",
  "textarea",
  "number",
  "select",
  "checkbox",
  "date",
];

function normOption(o: unknown): { label: string; value: string } | null {
  if (o == null) return null;
  if (typeof o === "string" || typeof o === "number" || typeof o === "boolean") {
    return { label: String(o), value: String(o) };
  }
  if (typeof o === "object") {
    const r = o as Record<string, unknown>;
    const value = r.value ?? r.id ?? r.key;
    if (value == null) return null;
    return { label: String(r.label ?? r.name ?? value), value: String(value) };
  }
  return null;
}

/**
 * Parse a human-task `form` blob into a renderable schema. Returns `null` when
 * the blob doesn't carry a usable `fields[]` array AND has no outcomes/prompt —
 * the caller then renders a raw JSON fallback.
 */
export function parseHumanForm(form: Record<string, unknown> | null | undefined): HumanFormSchema | null {
  if (!form || typeof form !== "object") return null;

  const promptRaw = form.prompt ?? form.title ?? form.message;
  const prompt = promptRaw == null ? null : String(promptRaw);

  const rawFields = form.fields ?? form.inputs;
  const fields: HumanFormField[] = [];
  if (Array.isArray(rawFields)) {
    for (const f of rawFields) {
      if (!f || typeof f !== "object") continue;
      const r = f as Record<string, unknown>;
      const name = r.name ?? r.id ?? r.key;
      if (name == null) continue;
      let type = String(r.type ?? "text").toLowerCase() as HumanFieldType;
      if ((type as string) === "boolean") type = "checkbox";
      if ((type as string) === "string") type = "text";
      if (!KNOWN_FIELD_TYPES.includes(type)) type = "text";
      const rawOpts = r.options ?? r.choices ?? r.values;
      const options = Array.isArray(rawOpts)
        ? rawOpts.map(normOption).filter((o): o is { label: string; value: string } => o != null)
        : [];
      fields.push({
        name: String(name),
        label: String(r.label ?? r.title ?? name),
        type: type === "select" && options.length === 0 ? "text" : type,
        required: Boolean(r.required),
        options,
        placeholder: r.placeholder != null ? String(r.placeholder) : undefined,
      });
    }
  }

  const rawOutcomes = form.outcomes ?? form.actions ?? form.decisions;
  const outcomes: string[] = Array.isArray(rawOutcomes)
    ? rawOutcomes
        .map((o) => (typeof o === "object" && o ? (o as Record<string, unknown>).value ?? (o as Record<string, unknown>).name : o))
        .filter((o) => o != null)
        .map(String)
    : [];

  // Not usable as a schema-driven form — let the caller fall back to raw JSON.
  if (fields.length === 0 && outcomes.length === 0 && prompt == null) return null;

  return { prompt, fields, outcomes };
}
