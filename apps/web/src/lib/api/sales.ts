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

const SVC = "/api/sales";

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, opts);
}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  code: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  billingAddress: string;
  active: boolean;
}

export type SOStatus = "draft" | "confirmed" | "shipped" | "invoiced" | "cancelled";

export interface SOLine {
  id: string;
  itemId: string | null;
  itemDesc: string;
  lineNo: number;
  qtyOrdered: number;
  qtyShipped: number;
  unitPrice: number;
  notes: string;
}

export interface SalesOrder {
  id: string;
  soNumber: string;
  customerId: string;
  status: SOStatus;
  orderDate: string;
  requestedDate: string | null;
  notes: string;
  lines: SOLine[];
}

// ─── Normalizers ──────────────────────────────────────────────────────────

function normCustomer(r: Record<string, unknown>): Customer {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    code: String(g(r, "code") ?? ""),
    name: String(g(r, "name") ?? ""),
    contact: String(g(r, "contact") ?? ""),
    email: String(g(r, "email") ?? ""),
    phone: String(g(r, "phone") ?? ""),
    billingAddress: String(gid(r, "billingAddress", "billing_address") ?? r["BillingAddress"] ?? ""),
    active: Boolean(g(r, "active") ?? true),
  };
}

function normSOLine(r: Record<string, unknown>): SOLine {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    itemId: (gid(r, "itemId", "item_id") ?? r["ItemID"] ?? null) as string | null,
    itemDesc: String(gid(r, "itemDesc", "item_desc") ?? r["ItemDesc"] ?? ""),
    lineNo: Number(gid(r, "lineNo", "line_no") ?? 0),
    qtyOrdered: Number(gid(r, "qtyOrdered", "qty_ordered") ?? 0),
    qtyShipped: Number(gid(r, "qtyShipped", "qty_shipped") ?? 0),
    unitPrice: Number(gid(r, "unitPrice", "unit_price") ?? 0),
    notes: String(g(r, "notes") ?? ""),
  };
}

function normSalesOrder(r: Record<string, unknown>): SalesOrder {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    soNumber: String(gid(r, "soNumber", "so_number") ?? r["SONumber"] ?? ""),
    customerId: String(gid(r, "customerId", "customer_id") ?? r["CustomerID"] ?? ""),
    status: (g(r, "status") ?? "draft") as SOStatus,
    orderDate: String(gid(r, "orderDate", "order_date") ?? r["OrderDate"] ?? ""),
    requestedDate: (gid(r, "requestedDate", "requested_date") ?? r["RequestedDate"] ?? null) as string | null,
    notes: String(g(r, "notes") ?? ""),
    lines: Array.isArray(r["lines"]) ? (r["lines"] as Record<string, unknown>[]).map(normSOLine) : [],
  };
}

// ─── Customers ─────────────────────────────────────────────────────────────

export async function listCustomers(): Promise<Customer[]> {
  const r = await apiFetch(`${SVC}/customers`);
  if (!r.ok) throw new Error(`listCustomers failed: ${r.status}`);
  const body = await r.json();
  return ((body.items ?? body) as Record<string, unknown>[] | null ?? []).map(normCustomer);
}

export async function createCustomer(input: { code: string; name: string; contact?: string; email?: string; phone?: string; billing_address?: string; active?: boolean }): Promise<Customer> {
  const r = await apiFetch(`${SVC}/customers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createCustomer failed: ${r.status}`); }
  return normCustomer(await r.json());
}

export async function getCustomer(id: string): Promise<Customer> {
  const r = await apiFetch(`${SVC}/customers/${id}`);
  if (!r.ok) throw new Error(`getCustomer failed: ${r.status}`);
  return normCustomer(await r.json());
}

export async function updateCustomer(id: string, patch: Partial<{ name: string; contact: string; email: string; phone: string; billing_address: string; active: boolean }>): Promise<Customer> {
  const r = await apiFetch(`${SVC}/customers/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateCustomer failed: ${r.status}`); }
  return normCustomer(await r.json());
}

export async function deleteCustomer(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/customers/${id}`, { method: "DELETE", headers: { "X-Confirm-Destructive": "true" } });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `deleteCustomer failed: ${r.status}`); }
}

// ─── Sales Orders ──────────────────────────────────────────────────────────

export async function listSalesOrders(params: { status?: string; q?: string; limit?: number; offset?: number } = {}): Promise<{ items: SalesOrder[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.q) qs.set("q", params.q);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("offset", String(params.offset ?? 0));
  const r = await apiFetch(`${SVC}/sales-orders?${qs}`);
  if (!r.ok) throw new Error(`listSalesOrders failed: ${r.status}`);
  const body = await r.json();
  return { items: ((body.items ?? []) as Record<string, unknown>[]).map(normSalesOrder), total: body.total ?? 0 };
}

export async function createSalesOrder(input: { customer_id: string; order_date?: string; requested_date?: string; notes?: string }): Promise<SalesOrder> {
  const r = await apiFetch(`${SVC}/sales-orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createSalesOrder failed: ${r.status}`); }
  return normSalesOrder(await r.json());
}

export async function getSalesOrder(id: string): Promise<SalesOrder> {
  const r = await apiFetch(`${SVC}/sales-orders/${id}`);
  if (!r.ok) throw new Error(`getSalesOrder failed: ${r.status}`);
  return normSalesOrder(await r.json());
}

export async function updateSalesOrder(id: string, patch: { status?: SOStatus; requested_date?: string | null; notes?: string }): Promise<SalesOrder> {
  const r = await apiFetch(`${SVC}/sales-orders/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateSalesOrder failed: ${r.status}`); }
  return normSalesOrder(await r.json());
}

export async function addSOLine(soId: string, line: { item_id?: string; item_desc: string; qty_ordered: number; unit_price?: number; notes?: string }): Promise<SOLine> {
  const r = await apiFetch(`${SVC}/sales-orders/${soId}/lines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(line) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `addSOLine failed: ${r.status}`); }
  return normSOLine(await r.json());
}

// ─── Quotations ────────────────────────────────────────────────────────────

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export interface Quote {
  id: string;
  code?: string;
  customer_id: string;
  customer_name?: string;
  title?: string;
  valid_until?: string;
  status: QuoteStatus;
  total_amount?: number;
  notes?: string;
  created_at?: string;
}

export async function listQuotes(params?: { status?: string; customer_id?: string }): Promise<Quote[]> {
  const q = new URLSearchParams();
  if (params?.status) q.set("status", params.status);
  if (params?.customer_id) q.set("customer_id", params.customer_id);
  const r = await apiFetch(`${SVC}/quotations?${q}`);
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : d?.quotes ?? [];
}

export async function createQuote(body: Omit<Quote, "id" | "code" | "customer_name">): Promise<Quote> {
  const r = await apiFetch("/api/sales/quotations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateQuoteStatus(id: string, status: QuoteStatus): Promise<void> {
  const r = await apiFetch(`/api/sales/quotations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function convertQuoteToOrder(quoteId: string): Promise<SalesOrder> {
  const r = await apiFetch(`/api/sales/quotations/${quoteId}/convert`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
