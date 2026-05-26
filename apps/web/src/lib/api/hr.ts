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

const SVC = "/api/hr";

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, opts);
}

// ─── types ─────────────────────────────────────────────────────────────────

export interface Department {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  parentId: string | null;
  parentName?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Position {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  departmentId: string | null;
  departmentName?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EmpStatus = "active" | "inactive" | "terminated" | "on_leave";

export interface Employee {
  id: string;
  tenantId: string;
  empNo: string;
  firstName: string;
  lastName: string;
  email: string;
  departmentId: string | null;
  departmentName?: string;
  positionId: string | null;
  positionName?: string;
  status: EmpStatus;
  hireDate: string;
  terminationDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── normalizers ───────────────────────────────────────────────────────────

function normalizeDept(r: Record<string, unknown>): Department {
  return {
    id: String(r.id ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    code: String(g(r, "code") ?? ""),
    name: String(g(r, "name") ?? ""),
    parentId: (gid(r, "parentId", "parent_id") as string | null) ?? null,
    parentName: r.parent_name ? String(r.parent_name) : r.parentName ? String(r.parentName) : undefined,
    active: Boolean(g(r, "active") ?? true),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

function normalizePosition(r: Record<string, unknown>): Position {
  return {
    id: String(r.id ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    code: String(g(r, "code") ?? ""),
    name: String(g(r, "name") ?? ""),
    departmentId: (gid(r, "departmentId", "department_id") as string | null) ?? null,
    departmentName: r.department_name ? String(r.department_name) : r.departmentName ? String(r.departmentName) : undefined,
    active: Boolean(g(r, "active") ?? true),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

function normalizeEmployee(r: Record<string, unknown>): Employee {
  return {
    id: String(r.id ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    empNo: String(gid(r, "empNo", "emp_no") ?? ""),
    firstName: String(gid(r, "firstName", "first_name") ?? ""),
    lastName: String(gid(r, "lastName", "last_name") ?? ""),
    email: String(g(r, "email") ?? ""),
    departmentId: (gid(r, "departmentId", "department_id") as string | null) ?? null,
    departmentName: r.department_name ? String(r.department_name) : r.departmentName ? String(r.departmentName) : undefined,
    positionId: (gid(r, "positionId", "position_id") as string | null) ?? null,
    positionName: r.position_name ? String(r.position_name) : r.positionName ? String(r.positionName) : undefined,
    status: (g(r, "status") ?? "active") as EmpStatus,
    hireDate: String(gid(r, "hireDate", "hire_date") ?? ""),
    terminationDate: (gid(r, "terminationDate", "termination_date") as string | null) ?? null,
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

// ─── departments ───────────────────────────────────────────────────────────

export async function listDepartments(q?: string): Promise<Department[]> {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  const r = await apiFetch(`${SVC}/departments${sp.toString() ? `?${sp}` : ""}`);
  if (!r.ok) throw new Error(`listDepartments: ${r.status}`);
  const data = await r.json() as unknown;
  const arr = Array.isArray(data) ? data : ((data as Record<string, unknown>).items ?? []) as unknown[];
  return (arr as Record<string, unknown>[]).map(normalizeDept);
}

export async function createDepartment(input: {
  code: string;
  name: string;
  parent_id?: string | null;
  active?: boolean;
}): Promise<Department> {
  const r = await apiFetch(`${SVC}/departments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createDepartment: ${r.status}`);
  return normalizeDept(await r.json() as Record<string, unknown>);
}

export async function updateDepartment(id: string, patch: Partial<{
  name: string;
  parent_id: string | null;
  active: boolean;
}>): Promise<Department> {
  const r = await apiFetch(`${SVC}/departments/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateDepartment: ${r.status}`);
  return normalizeDept(await r.json() as Record<string, unknown>);
}

export async function deleteDepartment(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/departments/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) throw new Error(`deleteDepartment: ${r.status}`);
}

// ─── positions ─────────────────────────────────────────────────────────────

export async function listPositions(q?: string): Promise<Position[]> {
  const sp = new URLSearchParams();
  if (q) sp.set("q", q);
  const r = await apiFetch(`${SVC}/positions${sp.toString() ? `?${sp}` : ""}`);
  if (!r.ok) throw new Error(`listPositions: ${r.status}`);
  const data = await r.json() as unknown;
  const arr = Array.isArray(data) ? data : ((data as Record<string, unknown>).items ?? []) as unknown[];
  return (arr as Record<string, unknown>[]).map(normalizePosition);
}

export async function createPosition(input: {
  code: string;
  name: string;
  department_id?: string | null;
  active?: boolean;
}): Promise<Position> {
  const r = await apiFetch(`${SVC}/positions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createPosition: ${r.status}`);
  return normalizePosition(await r.json() as Record<string, unknown>);
}

export async function updatePosition(id: string, patch: Partial<{
  name: string;
  department_id: string | null;
  active: boolean;
}>): Promise<Position> {
  const r = await apiFetch(`${SVC}/positions/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updatePosition: ${r.status}`);
  return normalizePosition(await r.json() as Record<string, unknown>);
}

export async function deletePosition(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/positions/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) throw new Error(`deletePosition: ${r.status}`);
}

// ─── employees ─────────────────────────────────────────────────────────────

export async function listEmployees(params?: {
  q?: string;
  dept_id?: string;
  status?: EmpStatus;
}): Promise<{ items: Employee[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.dept_id) sp.set("dept_id", params.dept_id);
  if (params?.status) sp.set("status", params.status);
  const r = await apiFetch(`${SVC}/employees${sp.toString() ? `?${sp}` : ""}`);
  if (!r.ok) throw new Error(`listEmployees: ${r.status}`);
  const data = await r.json() as unknown;
  if (Array.isArray(data)) return { items: (data as Record<string, unknown>[]).map(normalizeEmployee), total: data.length };
  const obj = data as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normalizeEmployee) : [];
  return { items, total: Number(obj.total ?? items.length) };
}

export async function createEmployee(input: {
  emp_no: string;
  first_name: string;
  last_name: string;
  email: string;
  department_id?: string | null;
  position_id?: string | null;
  hire_date?: string;
}): Promise<Employee> {
  const r = await apiFetch(`${SVC}/employees`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createEmployee: ${r.status}`);
  return normalizeEmployee(await r.json() as Record<string, unknown>);
}

export async function getEmployee(id: string): Promise<Employee> {
  const r = await apiFetch(`${SVC}/employees/${id}`);
  if (!r.ok) throw new Error(`getEmployee: ${r.status}`);
  return normalizeEmployee(await r.json() as Record<string, unknown>);
}

export async function updateEmployee(id: string, patch: Partial<{
  first_name: string;
  last_name: string;
  email: string;
  department_id: string | null;
  position_id: string | null;
  status: EmpStatus;
}>): Promise<Employee> {
  const r = await apiFetch(`${SVC}/employees/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateEmployee: ${r.status}`);
  return normalizeEmployee(await r.json() as Record<string, unknown>);
}

export async function terminateEmployee(id: string, termination_date: string): Promise<Employee> {
  const r = await apiFetch(`${SVC}/employees/${id}/terminate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ termination_date }),
  });
  if (!r.ok) throw new Error(`terminateEmployee: ${r.status}`);
  return normalizeEmployee(await r.json() as Record<string, unknown>);
}
