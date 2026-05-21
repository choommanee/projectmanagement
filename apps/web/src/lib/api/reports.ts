// ─── helpers ────────────────────────────────────────────────────────────────
// g: resolve camelCase, PascalCase, and Go ALL_CAPS keys (e.g. ID, TenantID)
function g(r: Record<string, unknown>, k: string): unknown {
  const goKey = k
    .replace(/^(.)/, (c) => c.toUpperCase())
    .replace(/Id$/, "ID")
    .replace(/Id([A-Z])/, "ID$1");
  return r[k] ?? r[goKey] ?? r[k[0].toUpperCase() + k.slice(1)];
}

const SVC = "/api/reports";

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, opts);
}

// ─── types ──────────────────────────────────────────────────────────────────

export type DashboardVisibility = "private" | "team" | "tenant";

export interface WidgetCfg {
  id: string;
  kind: "kpi" | "chart" | "list" | "iframe";
  title?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Record<string, unknown>;
}

export interface LayoutCfg {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dashboard {
  id: string;
  ownerId?: string | null;
  name: string;
  description: string;
  visibility: DashboardVisibility;
  layout: LayoutCfg[];
  widgets: WidgetCfg[];
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface SummaryMetrics {
  projects: { total: number; active: number; completed: number; planning: number };
  tasks: { total: number; open: number; done: number; overdue: number };
  workOrders: { total: number; planned: number; released: number; inProgress: number; completed: number };
  ncrsOpen: number;
  fmeaHighRpn: number;
  documents: { total: number; draft: number; approved: number };
  workflowRunsToday: number;
  auditEvents24h: number;
}

export interface TimeseriesPoint {
  day: string;
  count: number;
}

export interface ByStatusPoint {
  status: string;
  count: number;
}

// ─── normalization ───────────────────────────────────────────────────────────

function normDashboard(r: Record<string, unknown>): Dashboard {
  const layout = (g(r, "layout") ?? []) as LayoutCfg[];
  const widgets = (g(r, "widgets") ?? []) as WidgetCfg[];
  return {
    id: String(g(r, "id") ?? ""),
    ownerId: (g(r, "ownerId") ?? null) as string | null,
    name: String(g(r, "name") ?? ""),
    description: String(g(r, "description") ?? ""),
    visibility: (g(r, "visibility") ?? "private") as DashboardVisibility,
    layout: Array.isArray(layout) ? layout : [],
    widgets: Array.isArray(widgets) ? widgets : [],
    isPinned: Boolean(g(r, "isPinned") ?? g(r, "is_pinned") ?? false),
    createdAt: String(g(r, "createdAt") ?? ""),
    updatedAt: String(g(r, "updatedAt") ?? ""),
    version: Number(g(r, "version") ?? 1),
  };
}

function normSummary(r: Record<string, unknown>): SummaryMetrics {
  const proj = (r.projects ?? {}) as Record<string, number>;
  const tasks = (r.tasks ?? {}) as Record<string, number>;
  const wo = (r.workOrders ?? r.work_orders ?? {}) as Record<string, number>;
  const docs = (r.documents ?? {}) as Record<string, number>;
  return {
    projects: {
      total: proj.total ?? 0,
      active: proj.active ?? 0,
      completed: proj.completed ?? 0,
      planning: proj.planning ?? 0,
    },
    tasks: {
      total: tasks.total ?? 0,
      open: tasks.open ?? 0,
      done: tasks.done ?? 0,
      overdue: tasks.overdue ?? 0,
    },
    workOrders: {
      total: wo.total ?? 0,
      planned: wo.planned ?? 0,
      released: wo.released ?? 0,
      inProgress: wo.inProgress ?? wo.in_progress ?? 0,
      completed: wo.completed ?? 0,
    },
    ncrsOpen: Number(r.ncrsOpen ?? r.ncrs_open ?? 0),
    fmeaHighRpn: Number(r.fmeaHighRpn ?? r.fmea_high_rpn ?? 0),
    documents: {
      total: docs.total ?? 0,
      draft: docs.draft ?? 0,
      approved: docs.approved ?? 0,
    },
    workflowRunsToday: Number(r.workflowRunsToday ?? r.workflow_runs_today ?? 0),
    auditEvents24h: Number(r.auditEvents24h ?? r.audit_events_24h ?? 0),
  };
}

// ─── API functions ───────────────────────────────────────────────────────────

export async function listDashboards(opts?: {
  visibility?: DashboardVisibility;
  limit?: number;
  offset?: number;
}): Promise<{ items: Dashboard[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.visibility) params.set("visibility", opts.visibility);
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.offset) params.set("offset", String(opts.offset));
  const qs = params.toString();
  const res = await apiFetch(`${SVC}/dashboards${qs ? "?" + qs : ""}`);
  if (!res.ok) throw new Error(`listDashboards: ${res.status}`);
  const body = await res.json() as { items?: Record<string, unknown>[]; total?: number };
  return {
    items: (body.items ?? []).map(normDashboard),
    total: body.total ?? 0,
  };
}

export async function getDashboard(id: string): Promise<Dashboard> {
  const res = await apiFetch(`${SVC}/dashboards/${id}`);
  if (!res.ok) throw new Error(`getDashboard: ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  return normDashboard(body);
}

export async function createDashboard(input: {
  name: string;
  description?: string;
  visibility?: DashboardVisibility;
  layout?: LayoutCfg[];
  widgets?: WidgetCfg[];
  isPinned?: boolean;
}): Promise<Dashboard> {
  const res = await apiFetch(`${SVC}/dashboards`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      description: input.description ?? "",
      visibility: input.visibility ?? "private",
      layout: input.layout ?? [],
      widgets: input.widgets ?? [],
      is_pinned: input.isPinned ?? false,
    }),
  });
  if (!res.ok) throw new Error(`createDashboard: ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  return normDashboard(body);
}

export async function updateDashboard(
  id: string,
  patch: {
    name?: string;
    description?: string;
    visibility?: DashboardVisibility;
    layout?: LayoutCfg[];
    widgets?: WidgetCfg[];
    isPinned?: boolean;
    version: number;
  }
): Promise<Dashboard> {
  const res = await apiFetch(`${SVC}/dashboards/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: patch.name,
      description: patch.description,
      visibility: patch.visibility,
      layout: patch.layout,
      widgets: patch.widgets,
      is_pinned: patch.isPinned,
      version: patch.version,
    }),
  });
  if (!res.ok) throw new Error(`updateDashboard: ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  return normDashboard(body);
}

export async function deleteDashboard(id: string, version: number): Promise<void> {
  const res = await apiFetch(`${SVC}/dashboards/${id}?version=${version}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204) throw new Error(`deleteDashboard: ${res.status}`);
}

export async function getSummaryMetrics(): Promise<SummaryMetrics> {
  const res = await apiFetch(`${SVC}/metrics/summary`);
  if (!res.ok) throw new Error(`getSummaryMetrics: ${res.status}`);
  const body = await res.json() as Record<string, unknown>;
  return normSummary(body);
}

export async function getTimeseries(
  metric: "audit_events" | "workflow_runs" | "task_throughput" | "wo_releases",
  days = 14
): Promise<TimeseriesPoint[]> {
  const res = await apiFetch(`${SVC}/metrics/timeseries?metric=${metric}&days=${days}`);
  if (!res.ok) throw new Error(`getTimeseries: ${res.status}`);
  const body = await res.json() as TimeseriesPoint[];
  return Array.isArray(body) ? body : [];
}

export async function getByStatus(
  metric: "projects" | "tasks" | "work_orders" | "ncrs" | "documents"
): Promise<ByStatusPoint[]> {
  const res = await apiFetch(`${SVC}/metrics/by-status?metric=${metric}`);
  if (!res.ok) throw new Error(`getByStatus: ${res.status}`);
  const body = await res.json() as ByStatusPoint[];
  return Array.isArray(body) ? body : [];
}
