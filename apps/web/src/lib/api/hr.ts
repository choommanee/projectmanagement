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

// ─── payroll ───────────────────────────────────────────────────────────────

export type PayslipStatus = "draft" | "approved" | "paid";

export interface Payslip {
  id: string;
  tenant_id: string;
  employee_id: string;
  period_start: string;
  period_end: string;
  base_salary: number;
  allowances: number;
  deductions: number;
  net_pay: number;
  currency: string;
  status: PayslipStatus;
  approved_by?: string | null;
  approved_at?: string | null;
  paid_at?: string | null;
  created_at: string;
  updated_at: string;
}

function normalizePayslip(r: Record<string, unknown>): Payslip {
  return {
    id: String(r.id ?? ""),
    tenant_id: String(gid(r, "tenantId", "tenant_id") ?? ""),
    employee_id: String(gid(r, "employeeId", "employee_id") ?? ""),
    period_start: String(gid(r, "periodStart", "period_start") ?? ""),
    period_end: String(gid(r, "periodEnd", "period_end") ?? ""),
    base_salary: Number(gid(r, "baseSalary", "base_salary") ?? 0),
    allowances: Number(g(r, "allowances") ?? 0),
    deductions: Number(g(r, "deductions") ?? 0),
    net_pay: Number(gid(r, "netPay", "net_pay") ?? 0),
    currency: String(g(r, "currency") ?? "THB"),
    status: (g(r, "status") ?? "draft") as PayslipStatus,
    approved_by: (gid(r, "approvedBy", "approved_by") as string | null) ?? null,
    approved_at: (gid(r, "approvedAt", "approved_at") as string | null) ?? null,
    paid_at: (gid(r, "paidAt", "paid_at") as string | null) ?? null,
    created_at: String(gid(r, "createdAt", "created_at") ?? ""),
    updated_at: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

export async function listPayslips(params?: {
  employee_id?: string;
  status?: PayslipStatus | "";
  limit?: number;
  offset?: number;
}): Promise<{ items: Payslip[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.employee_id) sp.set("employee_id", params.employee_id);
  if (params?.status) sp.set("status", params.status);
  if (params?.limit != null) sp.set("limit", String(params.limit));
  if (params?.offset != null) sp.set("offset", String(params.offset));
  const r = await apiFetch(`${SVC}/payslips${sp.toString() ? `?${sp}` : ""}`);
  if (!r.ok) throw new Error(`listPayslips: ${r.status}`);
  const data = await r.json() as unknown;
  if (Array.isArray(data)) return { items: (data as Record<string, unknown>[]).map(normalizePayslip), total: data.length };
  const obj = data as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normalizePayslip) : [];
  return { items, total: Number(obj.total ?? items.length) };
}

export async function createPayslip(input: {
  employee_id: string;
  period_start: string;
  period_end: string;
  base_salary: number;
  allowances: number;
  deductions: number;
  currency?: string;
}): Promise<Payslip> {
  const r = await apiFetch(`${SVC}/payslips`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createPayslip: ${r.status}`);
  return normalizePayslip(await r.json() as Record<string, unknown>);
}

export async function getPayslip(id: string): Promise<Payslip> {
  const r = await apiFetch(`${SVC}/payslips/${id}`);
  if (!r.ok) throw new Error(`getPayslip: ${r.status}`);
  return normalizePayslip(await r.json() as Record<string, unknown>);
}

export async function approvePayslip(id: string): Promise<Payslip> {
  const r = await apiFetch(`${SVC}/payslips/${id}/approve`, { method: "POST" });
  if (!r.ok) throw new Error(`approvePayslip: ${r.status}`);
  return normalizePayslip(await r.json() as Record<string, unknown>);
}

export async function markPayslipPaid(id: string): Promise<Payslip> {
  const r = await apiFetch(`${SVC}/payslips/${id}/mark-paid`, { method: "POST" });
  if (!r.ok) throw new Error(`markPayslipPaid: ${r.status}`);
  return normalizePayslip(await r.json() as Record<string, unknown>);
}

// ─── leave requests ────────────────────────────────────────────────────────

export interface LeaveRequest {
  id: string;
  tenant_id: string;
  employee_id: string;
  leave_type: "annual" | "sick" | "maternity" | "paternity" | "unpaid" | "other";
  start_date: string;
  end_date: string;
  days: number;
  reason?: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  approved_by?: string;
  approved_at?: string;
  rejected_reason?: string;
  created_at: string;
  updated_at: string;
}

function normalizeLeaveRequest(r: Record<string, unknown>): LeaveRequest {
  return {
    id: String(r.id ?? ""),
    tenant_id: String(gid(r, "tenantId", "tenant_id") ?? ""),
    employee_id: String(gid(r, "employeeId", "employee_id") ?? ""),
    leave_type: (gid(r, "leaveType", "leave_type") ?? "annual") as LeaveRequest["leave_type"],
    start_date: String(gid(r, "startDate", "start_date") ?? ""),
    end_date: String(gid(r, "endDate", "end_date") ?? ""),
    days: Number(g(r, "days") ?? 0),
    reason: r.reason ? String(r.reason) : undefined,
    status: (g(r, "status") ?? "pending") as LeaveRequest["status"],
    approved_by: (gid(r, "approvedBy", "approved_by") as string | undefined) ?? undefined,
    approved_at: (gid(r, "approvedAt", "approved_at") as string | undefined) ?? undefined,
    rejected_reason: (gid(r, "rejectedReason", "rejected_reason") as string | undefined) ?? undefined,
    created_at: String(gid(r, "createdAt", "created_at") ?? ""),
    updated_at: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

export async function listLeaveRequests(params?: {
  employee_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: LeaveRequest[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.employee_id) sp.set("employee_id", params.employee_id);
  if (params?.status) sp.set("status", params.status);
  if (params?.limit != null) sp.set("limit", String(params.limit));
  if (params?.offset != null) sp.set("offset", String(params.offset));
  const r = await apiFetch(`${SVC}/leave-requests${sp.toString() ? `?${sp}` : ""}`);
  if (!r.ok) throw new Error(`listLeaveRequests: ${r.status}`);
  const data = await r.json() as unknown;
  if (Array.isArray(data)) return { items: (data as Record<string, unknown>[]).map(normalizeLeaveRequest), total: data.length };
  const obj = data as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normalizeLeaveRequest) : [];
  return { items, total: Number(obj.total ?? items.length) };
}

export async function createLeaveRequest(input: {
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  reason?: string;
}): Promise<LeaveRequest> {
  const r = await apiFetch(`${SVC}/leave-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createLeaveRequest: ${r.status}`);
  return normalizeLeaveRequest(await r.json() as Record<string, unknown>);
}

export async function getLeaveRequest(id: string): Promise<LeaveRequest> {
  const r = await apiFetch(`${SVC}/leave-requests/${id}`);
  if (!r.ok) throw new Error(`getLeaveRequest: ${r.status}`);
  return normalizeLeaveRequest(await r.json() as Record<string, unknown>);
}

export async function approveLeaveRequest(id: string): Promise<LeaveRequest> {
  const r = await apiFetch(`${SVC}/leave-requests/${id}/approve`, { method: "POST" });
  if (!r.ok) throw new Error(`approveLeaveRequest: ${r.status}`);
  return normalizeLeaveRequest(await r.json() as Record<string, unknown>);
}

export async function rejectLeaveRequest(id: string, reason: string): Promise<LeaveRequest> {
  const r = await apiFetch(`${SVC}/leave-requests/${id}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!r.ok) throw new Error(`rejectLeaveRequest: ${r.status}`);
  return normalizeLeaveRequest(await r.json() as Record<string, unknown>);
}

// ─── payroll runs ──────────────────────────────────────────────────────────

export interface PayrollRun {
  id: string;
  period_start: string;
  period_end: string;
  status: "draft" | "processing" | "completed" | "cancelled";
  total_employees: number;
  total_net_pay: number;
  created_at: string;
  completed_at?: string;
}

export async function listPayrollRuns(): Promise<PayrollRun[]> {
  const r = await apiFetch(`${SVC}/payroll-runs`);
  if (!r.ok) return [];
  const d = await r.json() as unknown;
  return Array.isArray(d) ? (d as PayrollRun[]) : ((d as Record<string, unknown>)?.runs as PayrollRun[] ?? []);
}

export async function createPayrollRun(body: { period_start: string; period_end: string }): Promise<PayrollRun> {
  const r = await apiFetch(`${SVC}/payroll-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<PayrollRun>;
}

// ─── training records ──────────────────────────────────────────────────────

export type TrainingStatus = "enrolled" | "in_progress" | "completed" | "expired";

export interface TrainingRecord {
  id: string;
  employee_id: string;
  employee_name?: string;
  course_name: string;
  provider?: string;
  started_at?: string;
  completed_at?: string;
  expiry_date?: string;
  status: TrainingStatus;
  certificate_no?: string;
  notes?: string;
}

export async function listTrainingRecords(params?: { employee_id?: string; status?: string }): Promise<TrainingRecord[]> {
  const q = new URLSearchParams();
  if (params?.employee_id) q.set("employee_id", params.employee_id);
  if (params?.status) q.set("status", params.status);
  const r = await apiFetch(`${SVC}/training?${q}`);
  if (!r.ok) return [];
  const d = await r.json() as unknown;
  return Array.isArray(d) ? (d as TrainingRecord[]) : ((d as Record<string, unknown>)?.records as TrainingRecord[] ?? []);
}

export async function getTrainingRecord(id: string): Promise<TrainingRecord> {
  const r = await apiFetch(`${SVC}/training/${id}`);
  if (!r.ok) throw new Error(`getTrainingRecord: ${r.status}`);
  return r.json() as Promise<TrainingRecord>;
}

export async function createTrainingRecord(body: Omit<TrainingRecord, "id" | "employee_name">): Promise<TrainingRecord> {
  const r = await apiFetch(`${SVC}/training`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json() as Promise<TrainingRecord>;
}

export async function updateTrainingStatus(id: string, status: TrainingStatus, certificate_no?: string): Promise<void> {
  const r = await apiFetch(`${SVC}/training/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, certificate_no }),
  });
  if (!r.ok) throw new Error(await r.text());
}

// ─── Performance Reviews ────────────────────────────────────────────────────

export type ReviewStatus = "draft" | "self_review" | "manager_review" | "completed";
export type ReviewRating = 1 | 2 | 3 | 4 | 5;

export interface PerformanceGoal {
  id: string;
  description: string;
  weight: number;
  selfRating: ReviewRating | null;
  managerRating: ReviewRating | null;
}

export interface PerformanceReview {
  id: string;
  employeeId: string;
  employeeName: string;
  reviewPeriod: string;
  status: ReviewStatus;
  overallRating: ReviewRating | null;
  goals: PerformanceGoal[];
  managerComments: string;
  selfComments: string;
  createdAt: string;
  updatedAt: string;
}

function normGoal(r: Record<string, unknown>): PerformanceGoal {
  return {
    id: String(r.id ?? ""),
    description: String(g(r, "description") ?? ""),
    weight: Number(g(r, "weight") ?? 0),
    selfRating: (gid(r, "selfRating", "self_rating") as ReviewRating | null) ?? null,
    managerRating: (gid(r, "managerRating", "manager_rating") as ReviewRating | null) ?? null,
  };
}

function normReview(r: Record<string, unknown>): PerformanceReview {
  return {
    id: String(r.id ?? ""),
    employeeId: String(gid(r, "employeeId", "employee_id") ?? ""),
    employeeName: String(gid(r, "employeeName", "employee_name") ?? ""),
    reviewPeriod: String(gid(r, "reviewPeriod", "review_period") ?? ""),
    status: (g(r, "status") ?? "draft") as ReviewStatus,
    overallRating: (gid(r, "overallRating", "overall_rating") as ReviewRating | null) ?? null,
    goals: Array.isArray(r.goals) ? (r.goals as Record<string, unknown>[]).map(normGoal) : [],
    managerComments: String(gid(r, "managerComments", "manager_comments") ?? ""),
    selfComments: String(gid(r, "selfComments", "self_comments") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

export async function listPerformanceReviews(params?: {
  status?: ReviewStatus;
  employee_id?: string;
}): Promise<{ items: PerformanceReview[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.employee_id) sp.set("employee_id", params.employee_id);
  const r = await apiFetch(`${SVC}/performance-reviews?${sp}`);
  if (!r.ok) throw new Error(`listPerformanceReviews: ${r.status}`);
  const data = await r.json();
  if (Array.isArray(data)) return { items: (data as Record<string, unknown>[]).map(normReview), total: data.length };
  const obj = data as Record<string, unknown>;
  return { items: Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normReview) : [], total: Number(obj.total ?? 0) };
}

export async function createPerformanceReview(input: {
  employee_id: string;
  review_period: string;
}): Promise<PerformanceReview> {
  const r = await apiFetch(`${SVC}/performance-reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createPerformanceReview: ${r.status}`);
  return normReview(await r.json());
}

export async function updatePerformanceReview(
  id: string,
  patch: Partial<{
    status: ReviewStatus;
    overall_rating: ReviewRating;
    self_comments: string;
    manager_comments: string;
  }>
): Promise<PerformanceReview> {
  const r = await apiFetch(`${SVC}/performance-reviews/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updatePerformanceReview: ${r.status}`);
  return normReview(await r.json());
}

// ─── Recruitment ────────────────────────────────────────────────────────────

export type JobStatus = "open" | "closed" | "draft" | "on_hold";
export type ApplicantStage = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected";

export interface JobPosting {
  id: string;
  title: string;
  departmentId: string | null;
  departmentName: string;
  positionId: string | null;
  positionName: string;
  status: JobStatus;
  openings: number;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Applicant {
  id: string;
  jobId: string;
  name: string;
  email: string;
  phone: string;
  stage: ApplicantStage;
  notes: string;
  appliedAt: string;
  updatedAt: string;
}

function normJobPosting(r: Record<string, unknown>): JobPosting {
  return {
    id: String(r.id ?? ""),
    title: String(g(r, "title") ?? ""),
    departmentId: (gid(r, "departmentId", "department_id") as string | null) ?? null,
    departmentName: String(gid(r, "departmentName", "department_name") ?? ""),
    positionId: (gid(r, "positionId", "position_id") as string | null) ?? null,
    positionName: String(gid(r, "positionName", "position_name") ?? ""),
    status: (g(r, "status") ?? "draft") as JobStatus,
    openings: Number(g(r, "openings") ?? 1),
    description: String(g(r, "description") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

function normApplicant(r: Record<string, unknown>): Applicant {
  return {
    id: String(r.id ?? ""),
    jobId: String(gid(r, "jobId", "job_id") ?? ""),
    name: String(g(r, "name") ?? ""),
    email: String(g(r, "email") ?? ""),
    phone: String(g(r, "phone") ?? ""),
    stage: (g(r, "stage") ?? "applied") as ApplicantStage,
    notes: String(g(r, "notes") ?? ""),
    appliedAt: String(gid(r, "appliedAt", "applied_at") ?? gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

export async function listJobPostings(params?: { status?: JobStatus }): Promise<{ items: JobPosting[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  const r = await apiFetch(`${SVC}/jobs?${sp}`);
  if (!r.ok) throw new Error(`listJobPostings: ${r.status}`);
  const data = await r.json();
  if (Array.isArray(data)) return { items: (data as Record<string, unknown>[]).map(normJobPosting), total: data.length };
  const obj = data as Record<string, unknown>;
  return { items: Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normJobPosting) : [], total: Number(obj.total ?? 0) };
}

export async function createJobPosting(input: {
  title: string;
  department_id?: string;
  position_id?: string;
  openings?: number;
  description?: string;
}): Promise<JobPosting> {
  const r = await apiFetch(`${SVC}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createJobPosting: ${r.status}`);
  return normJobPosting(await r.json());
}

export async function updateJobPosting(id: string, patch: Partial<{ status: JobStatus; openings: number; description: string }>): Promise<JobPosting> {
  const r = await apiFetch(`${SVC}/jobs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateJobPosting: ${r.status}`);
  return normJobPosting(await r.json());
}

export async function listApplicants(jobId: string): Promise<Applicant[]> {
  const r = await apiFetch(`${SVC}/jobs/${jobId}/applicants`);
  if (!r.ok) throw new Error(`listApplicants: ${r.status}`);
  const data = await r.json();
  if (Array.isArray(data)) return (data as Record<string, unknown>[]).map(normApplicant);
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normApplicant) : [];
}

export async function createApplicant(jobId: string, input: { name: string; email: string; phone?: string; notes?: string }): Promise<Applicant> {
  const r = await apiFetch(`${SVC}/jobs/${jobId}/applicants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createApplicant: ${r.status}`);
  return normApplicant(await r.json());
}

export async function updateApplicantStage(jobId: string, applicantId: string, stage: ApplicantStage): Promise<Applicant> {
  const r = await apiFetch(`${SVC}/jobs/${jobId}/applicants/${applicantId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stage }),
  });
  if (!r.ok) throw new Error(`updateApplicantStage: ${r.status}`);
  return normApplicant(await r.json());
}
