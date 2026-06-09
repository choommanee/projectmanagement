export type WorkspaceKind = "pm" | "ba" | "sa" | "expert";

export type DocumentType =
  | "project_charter" | "status_report" | "risk_register" | "issue_log" | "change_request" | "stakeholder_register"
  | "brd" | "frd" | "user_story" | "use_case" | "process_flow" | "rtm"
  | "sdd" | "adr" | "er_diagram" | "api_spec" | "sequence_diagram" | "tech_stack"
  | "knowledge_article" | "decision_log" | "qa" | "lesson_learned" | "expertise_profile"
  | "note";

export type DocumentStatus = "draft" | "review" | "approved" | "archived";

export const TYPES_BY_KIND: Record<WorkspaceKind, { value: DocumentType; label: string }[]> = {
  pm: [
    { value: "project_charter", label: "Project Charter" },
    { value: "status_report",   label: "Status Report" },
    { value: "risk_register",   label: "Risk Register" },
    { value: "issue_log",       label: "Issue Log" },
    { value: "change_request",  label: "Change Request" },
    { value: "stakeholder_register", label: "Stakeholder Register" },
  ],
  ba: [
    { value: "brd",          label: "BRD" },
    { value: "frd",          label: "FRD" },
    { value: "user_story",   label: "User Story" },
    { value: "use_case",     label: "Use Case" },
    { value: "process_flow", label: "Process Flow" },
    { value: "rtm",          label: "RTM" },
  ],
  sa: [
    { value: "sdd",              label: "Software Design Doc" },
    { value: "adr",              label: "Architecture Decision Record" },
    { value: "er_diagram",       label: "ER Diagram" },
    { value: "api_spec",         label: "API Spec" },
    { value: "sequence_diagram", label: "Sequence Diagram" },
    { value: "tech_stack",       label: "Tech Stack Decision" },
  ],
  expert: [
    { value: "knowledge_article", label: "Knowledge Article" },
    { value: "decision_log",      label: "Decision Log" },
    { value: "qa",                label: "Q&A" },
    { value: "lesson_learned",    label: "Lesson Learned" },
    { value: "expertise_profile", label: "Expertise Profile" },
  ],
};

export interface Workspace {
  id: string; tenantId: string; projectId: string;
  kind: WorkspaceKind; name: string;
  createdAt: string; updatedAt: string;
}

export interface DocSummary {
  id: string; tenantId: string; workspaceId: string; projectId: string;
  type: DocumentType; title: string;
  status: DocumentStatus; ownerId?: string | null;
  tags: string[];
  createdAt: string; updatedAt: string; version: number;
}

export interface Document extends DocSummary {
  body: Record<string, unknown>;
  metadata?: Record<string, unknown> | null;
  currentVersionId?: string | null;
}

export interface DocumentVersion {
  id: string; documentId: string; rev: number;
  title: string; body: Record<string, unknown>;
  status: DocumentStatus; createdBy?: string | null;
  createdAt: string; note: string;
}

export interface DocComment {
  id: string; documentId: string;
  parentId?: string | null;
  authorId?: string | null;
  body: string;
  anchor?: Record<string, unknown> | null;
  createdAt: string; updatedAt: string;
  resolvedAt?: string | null;
}

export interface Template {
  id: string; type: DocumentType; name: string;
  body: Record<string, unknown>;
  isSystem: boolean; createdAt: string;
}

// Backend (document-svc) is canonical snake_case — map once, cleanly.
// (Earlier drafts emitted PascalCase; that shape is dead.)

function normWs(r: Record<string, unknown>): Workspace {
  return {
    id: String(r["id"] ?? ""),
    tenantId: String(r["tenant_id"] ?? ""),
    projectId: String(r["project_id"] ?? ""),
    kind: (r["kind"] ?? "pm") as WorkspaceKind,
    name: String(r["name"] ?? ""),
    createdAt: String(r["created_at"] ?? ""),
    updatedAt: String(r["updated_at"] ?? ""),
  };
}

function normDoc(r: Record<string, unknown>): Document {
  return {
    id: String(r["id"] ?? ""),
    tenantId: String(r["tenant_id"] ?? ""),
    workspaceId: String(r["workspace_id"] ?? ""),
    projectId: String(r["project_id"] ?? ""),
    type: (r["type"] ?? "note") as DocumentType,
    title: String(r["title"] ?? ""),
    body: (r["body"] ?? { type: "doc", content: [] }) as Record<string, unknown>,
    metadata: (r["metadata"] ?? null) as Record<string, unknown> | null,
    status: (r["status"] ?? "draft") as DocumentStatus,
    ownerId: (r["owner_id"] ?? null) as string | null,
    tags: (r["tags"] as string[] | null) ?? [],
    currentVersionId: (r["current_version_id"] ?? null) as string | null,
    createdAt: String(r["created_at"] ?? ""),
    updatedAt: String(r["updated_at"] ?? ""),
    version: Number(r["version"] ?? 1),
  };
}

function normVersion(r: Record<string, unknown>): DocumentVersion {
  return {
    id: String(r["id"] ?? ""),
    documentId: String(r["document_id"] ?? ""),
    rev: Number(r["rev"] ?? 0),
    title: String(r["title"] ?? ""),
    body: (r["body"] ?? {}) as Record<string, unknown>,
    status: (r["status"] ?? "draft") as DocumentStatus,
    createdBy: (r["created_by"] ?? null) as string | null,
    createdAt: String(r["created_at"] ?? ""),
    note: String(r["note"] ?? ""),
  };
}

function normComment(r: Record<string, unknown>): DocComment {
  return {
    id: String(r["id"] ?? ""),
    documentId: String(r["document_id"] ?? ""),
    parentId: (r["parent_id"] ?? null) as string | null,
    authorId: (r["author_id"] ?? null) as string | null,
    body: String(r["body"] ?? ""),
    anchor: (r["anchor"] ?? null) as Record<string, unknown> | null,
    createdAt: String(r["created_at"] ?? ""),
    updatedAt: String(r["updated_at"] ?? ""),
    resolvedAt: (r["resolved_at"] ?? null) as string | null,
  };
}

function normTemplate(r: Record<string, unknown>): Template {
  return {
    id: String(r["id"] ?? ""),
    type: (r["type"] ?? "note") as DocumentType,
    name: String(r["name"] ?? ""),
    body: (r["body"] ?? {}) as Record<string, unknown>,
    isSystem: Boolean(r["is_system"]),
    createdAt: String(r["created_at"] ?? ""),
  };
}

// Workspaces
export async function listAllWorkspaces(params?: { kind?: WorkspaceKind; limit?: number; offset?: number }): Promise<{ items: Workspace[]; total: number }> {
  const qs = new URLSearchParams();
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  const r = await fetch(`/api/workspaces?${qs}`);
  if (!r.ok) throw new Error(`list all ws failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return { items: (arr ?? []).map(normWs), total: body.total ?? (arr ?? []).length };
}

export async function listWorkspaces(projectId: string): Promise<Workspace[]> {
  const r = await fetch(`/api/workspaces?project_id=${projectId}`);
  if (!r.ok) throw new Error(`list ws failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return (arr ?? []).map(normWs);
}

export async function ensureWorkspace(projectId: string, kind: WorkspaceKind, name: string): Promise<Workspace> {
  const r = await fetch(`/api/workspaces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ project_id: projectId, kind, name }) });
  if (!r.ok) throw new Error(`ensure ws failed: ${r.status}`);
  return normWs(await r.json());
}

export async function getWorkspace(id: string): Promise<Workspace> {
  const r = await fetch(`/api/workspaces/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`getWorkspace: ${r.status}`);
  return normWs(await r.json());
}

// Documents
export async function listDocuments(params: { workspace_id?: string; project_id?: string; type?: DocumentType; status?: DocumentStatus; q?: string; limit?: number; offset?: number }): Promise<{ items: DocSummary[]; total: number }> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
  const r = await fetch(`/api/documents?${qs}`);
  if (!r.ok) throw new Error(`list docs failed: ${r.status}`);
  const body = await r.json();
  return { items: (body.items as Record<string, unknown>[] | null ?? []).map(normDoc), total: body.total ?? 0 };
}

export async function getDocument(id: string): Promise<Document> {
  const r = await fetch(`/api/documents/${id}`);
  if (!r.ok) throw new Error(`get doc failed: ${r.status}`);
  return normDoc(await r.json());
}

export async function createDocument(input: { workspace_id: string; project_id: string; type: DocumentType; title: string; body?: Record<string, unknown>; owner_id?: string; tags?: string[] }): Promise<Document> {
  const r = await fetch(`/api/documents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({})); throw new Error(e.error ?? `create doc failed: ${r.status}`);
  }
  return normDoc(await r.json());
}

export async function updateDocument(id: string, patch: { title?: string; body?: Record<string, unknown>; metadata?: Record<string, unknown>; status?: DocumentStatus; owner_id?: string | null; tags?: string[]; version: number }): Promise<Document> {
  const r = await fetch(`/api/documents/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) {
    const e = await r.json().catch(() => ({})); throw new Error(e.error ?? `update doc failed: ${r.status}`);
  }
  return normDoc(await r.json());
}

export async function deleteDocument(id: string, version: number): Promise<void> {
  const r = await fetch(`/api/documents/${id}?version=${version}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`delete doc failed: ${r.status}`);
}

// Versions
export async function listVersions(documentId: string): Promise<DocumentVersion[]> {
  const r = await fetch(`/api/documents/${documentId}/versions`);
  if (!r.ok) throw new Error(`versions failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return (arr ?? []).map(normVersion);
}
export async function getVersion(documentId: string, rev: number): Promise<DocumentVersion> {
  const r = await fetch(`/api/documents/${documentId}/versions/${rev}`);
  if (!r.ok) throw new Error(`version failed: ${r.status}`);
  return normVersion(await r.json());
}
export async function restoreVersion(documentId: string, rev: number, version: number): Promise<Document> {
  const r = await fetch(`/api/documents/${documentId}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rev, version }) });
  if (!r.ok) throw new Error(`restore failed: ${r.status}`);
  return normDoc(await r.json());
}

// Comments
export async function listComments(documentId: string): Promise<DocComment[]> {
  const r = await fetch(`/api/documents/${documentId}/comments`);
  if (!r.ok) throw new Error(`comments failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return (arr ?? []).map(normComment);
}
export async function createComment(documentId: string, body: string, parentId?: string): Promise<DocComment> {
  const r = await fetch(`/api/documents/${documentId}/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body, parent_id: parentId ?? null }) });
  if (!r.ok) throw new Error(`comment create failed: ${r.status}`);
  return normComment(await r.json());
}
export async function resolveComment(id: string): Promise<void> {
  const r = await fetch(`/api/comments/${id}/resolve`, { method: "PATCH" });
  if (!r.ok) throw new Error(`resolve failed: ${r.status}`);
}
export async function deleteComment(id: string): Promise<void> {
  const r = await fetch(`/api/comments/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`comment delete failed: ${r.status}`);
}

// Templates
export async function getTemplate(id: string): Promise<Template> {
  const r = await fetch(`/api/templates/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`getTemplate: ${r.status}`);
  const d = await r.json();
  return normTemplate(d);
}

// instantiateTemplate creates a brand-new document seeded from a template's
// body + type. This is the "create from template" path on the template detail
// page. The template body is deep-copied server-side (createDocument persists
// whatever body it receives), so future edits never mutate the template.
export async function instantiateTemplate(
  tmpl: Template,
  input: { workspace_id: string; project_id: string; title: string; tags?: string[] },
): Promise<Document> {
  return createDocument({
    workspace_id: input.workspace_id,
    project_id: input.project_id,
    type: tmpl.type,
    title: input.title,
    body: tmpl.body,
    tags: input.tags,
  });
}

// createTemplate persists a new (custom) template. Body is TipTap doc JSON —
// the same shape document bodies use — authored via DocEditor, not raw JSON.
export async function createTemplate(input: { type: DocumentType; name: string; body: Record<string, unknown> }): Promise<Template> {
  const r = await fetch(`/api/templates`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: input.type, name: input.name, body: input.body }),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({})); throw new Error(e.error ?? `create template failed: ${r.status}`);
  }
  return normTemplate(await r.json());
}

// updateTemplate edits a custom template's name/type/body. System templates
// are read-only server-side (403). Omitted fields are left unchanged.
export async function updateTemplate(id: string, patch: { type?: DocumentType; name?: string; body?: Record<string, unknown> }): Promise<Template> {
  const r = await fetch(`/api/templates/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({})); throw new Error(e.error ?? `update template failed: ${r.status}`);
  }
  return normTemplate(await r.json());
}

// deleteTemplate removes a custom template. System templates cannot be deleted
// (403 from the backend).
export async function deleteTemplate(id: string): Promise<void> {
  const r = await fetch(`/api/templates/${id}`, { method: "DELETE" });
  if (!r.ok) {
    const e = await r.json().catch(() => ({})); throw new Error(e.error ?? `delete template failed: ${r.status}`);
  }
}

export async function listTemplates(type?: DocumentType): Promise<Template[]> {
  const qs = type ? `?type=${type}` : "";
  const r = await fetch(`/api/templates${qs}`);
  if (!r.ok) throw new Error(`templates failed: ${r.status}`);
  const body = await r.json();
  const arr = (body.items ?? body) as Record<string, unknown>[] | null;
  return (arr ?? []).map(normTemplate);
}
