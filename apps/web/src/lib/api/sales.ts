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

export async function updateSalesOrder(id: string, patch: { status?: SOStatus; requested_date?: string | null; notes?: string; version?: number }): Promise<SalesOrder> {
  const r = await apiFetch(`${SVC}/sales-orders/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateSalesOrder failed: ${r.status}`); }
  return normSalesOrder(await r.json());
}

export async function deleteSalesOrder(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/sales-orders/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `deleteSalesOrder failed: ${r.status}`); }
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
  return Array.isArray(d) ? d : (d?.items ?? d?.quotes ?? []);
}

export async function getQuote(id: string): Promise<Quote> {
  const r = await apiFetch(`${SVC}/quotations/${id}`);
  if (!r.ok) throw new Error(`getQuote failed: ${r.status}`);
  const d = await r.json() as Record<string, unknown>;
  return {
    id: String(d.id ?? ""),
    code: d.code ? String(d.code) : undefined,
    customer_id: String(d.customer_id ?? d.customerId ?? ""),
    customer_name: d.customer_name ? String(d.customer_name) : d.customerName ? String(d.customerName) : undefined,
    title: d.title ? String(d.title) : undefined,
    valid_until: d.valid_until ? String(d.valid_until) : d.validUntil ? String(d.validUntil) : undefined,
    status: (d.status ?? "draft") as QuoteStatus,
    total_amount: d.total_amount != null ? Number(d.total_amount) : d.totalAmount != null ? Number(d.totalAmount) : undefined,
    notes: d.notes ? String(d.notes) : undefined,
    created_at: d.created_at ? String(d.created_at) : d.createdAt ? String(d.createdAt) : undefined,
  };
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

export async function updateQuote(id: string, patch: Partial<{ title: string; status: QuoteStatus; valid_until: string; notes: string; version: number }>): Promise<Quote> {
  const r = await apiFetch(`/api/sales/quotations/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteQuote(id: string): Promise<void> {
  const r = await apiFetch(`/api/sales/quotations/${id}`, {
    method: "DELETE",
  });
  if (!r.ok && r.status !== 204) throw new Error(await r.text());
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

// ─── Sales Invoices ────────────────────────────────────────────────────────

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

export interface SalesInvoice {
  id: string;
  code?: string;
  so_id?: string;
  customer_id: string;
  customer_name?: string;
  issue_date: string;
  due_date?: string;
  status: InvoiceStatus;
  subtotal?: number;
  tax?: number;
  total?: number;
  notes?: string;
  created_at?: string;
}

export async function listSalesInvoices(params?: { status?: string }): Promise<SalesInvoice[]> {
  const q = params?.status ? `?status=${params.status}` : "";
  const r = await apiFetch(`/api/sales/invoices${q}`);
  if (!r.ok) return [];
  const d = await r.json();
  return Array.isArray(d) ? d : (d?.items ?? d?.invoices ?? []);
}

export async function createSalesInvoice(body: {
  so_id?: string;
  customer_id: string;
  issue_date: string;
  due_date?: string;
  notes?: string;
}): Promise<SalesInvoice> {
  const r = await apiFetch("/api/sales/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<void> {
  const r = await apiFetch(`/api/sales/invoices/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!r.ok) throw new Error(await r.text());
}

export async function updateInvoice(id: string, patch: Partial<{ status: InvoiceStatus; due_date: string; notes: string; version: number }>): Promise<SalesInvoice> {
  const r = await apiFetch(`/api/sales/invoices/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function deleteSalesInvoice(id: string): Promise<void> {
  const r = await apiFetch(`/api/sales/invoices/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) throw new Error(await r.text());
}

export async function getSalesInvoice(id: string): Promise<SalesInvoice> {
  const r = await apiFetch(`${SVC}/invoices/${id}`);
  if (!r.ok) throw new Error(`getSalesInvoice: ${r.status}`);
  return r.json();
}

// ─── Shipments ─────────────────────────────────────────────────────────────

export type ShipmentStatus = "pending" | "packed" | "shipped" | "delivered" | "returned";

export interface Shipment {
  id: string;
  shipmentNumber: string;
  soId: string;
  soNumber?: string;
  customerId?: string;
  customerName?: string;
  status: ShipmentStatus;
  createdAt: string;
  updatedAt?: string;
  notes?: string;
}

function normShipment(r: Record<string, unknown>): Shipment {
  return {
    id: String(g(r, "id") ?? r["ID"] ?? ""),
    shipmentNumber: String(gid(r, "shipmentNumber", "shipment_number") ?? r["ShipmentNumber"] ?? ""),
    soId: String(gid(r, "soId", "so_id") ?? r["SOID"] ?? r["SoID"] ?? ""),
    soNumber: String(gid(r, "soNumber", "so_number") ?? r["SONumber"] ?? ""),
    customerId: String(gid(r, "customerId", "customer_id") ?? r["CustomerID"] ?? ""),
    customerName: String(gid(r, "customerName", "customer_name") ?? r["CustomerName"] ?? ""),
    status: (g(r, "status") ?? "pending") as ShipmentStatus,
    createdAt: String(gid(r, "createdAt", "created_at") ?? r["CreatedAt"] ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? r["UpdatedAt"] ?? ""),
    notes: String(g(r, "notes") ?? ""),
  };
}

export async function listShipments(params: { status?: string; limit?: number; offset?: number } = {}): Promise<{ items: Shipment[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  qs.set("limit", String(params.limit ?? 50));
  qs.set("offset", String(params.offset ?? 0));
  const r = await apiFetch(`${SVC}/shipments?${qs}`);
  if (!r.ok) throw new Error(`listShipments failed: ${r.status}`);
  const body = await r.json();
  return { items: ((body.items ?? body ?? []) as Record<string, unknown>[]).map(normShipment), total: body.total ?? 0 };
}

export async function createShipment(input: { so_id: string; notes?: string }): Promise<Shipment> {
  const r = await apiFetch(`${SVC}/shipments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createShipment failed: ${r.status}`); }
  return normShipment(await r.json());
}

export async function updateShipmentStatus(id: string, status: ShipmentStatus): Promise<void> {
  const r = await apiFetch(`${SVC}/shipments/${id}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateShipmentStatus failed: ${r.status}`); }
}

export async function updateShipment(id: string, patch: Partial<{ status: ShipmentStatus; tracking_no: string; carrier: string; ship_date: string; notes: string }>): Promise<Shipment> {
  const r = await apiFetch(`${SVC}/shipments/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `updateShipment failed: ${r.status}`); }
  return normShipment(await r.json());
}

export async function deleteShipment(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/shipments/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `deleteShipment failed: ${r.status}`); }
}

export async function getShipment(id: string): Promise<Shipment> {
  const r = await apiFetch(`${SVC}/shipments/${id}`);
  if (!r.ok) throw new Error(`getShipment: ${r.status}`);
  return normShipment(await r.json());
}

// ─── CRM Pipeline ──────────────────────────────────────────────────────────

export type OpportunityStage = "prospect" | "qualified" | "proposal" | "negotiation" | "won" | "lost";

export interface Opportunity {
  id: string;
  title: string;
  customerId: string;
  customerName: string;
  stage: OpportunityStage;
  value: number;
  currency: string;
  expectedCloseDate: string | null;
  probability: number;
  assignedTo: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

function normOpportunity(r: Record<string, unknown>): Opportunity {
  return {
    id: String(r.id ?? ""),
    title: String(g(r, "title") ?? ""),
    customerId: String(gid(r, "customerId", "customer_id") ?? r["CustomerID"] ?? ""),
    customerName: String(gid(r, "customerName", "customer_name") ?? ""),
    stage: (g(r, "stage") ?? "prospect") as OpportunityStage,
    value: Number(g(r, "value") ?? 0),
    currency: String(g(r, "currency") ?? "THB"),
    expectedCloseDate: (gid(r, "expectedCloseDate", "expected_close_date") as string | null) ?? null,
    probability: Number(g(r, "probability") ?? 0),
    assignedTo: String(gid(r, "assignedTo", "assigned_to") ?? ""),
    notes: String(g(r, "notes") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

export async function listOpportunities(params: {
  stage?: OpportunityStage;
  customer_id?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ items: Opportunity[]; total: number }> {
  const sp = new URLSearchParams();
  if (params.stage) sp.set("stage", params.stage);
  if (params.customer_id) sp.set("customer_id", params.customer_id);
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.offset) sp.set("offset", String(params.offset));
  const r = await apiFetch(`${SVC}/opportunities?${sp}`);
  if (!r.ok) throw new Error(`listOpportunities failed: ${r.status}`);
  const body = await r.json() as Record<string, unknown>;
  if (Array.isArray(body)) return { items: (body as Record<string, unknown>[]).map(normOpportunity), total: (body as unknown[]).length };
  return { items: ((body.items ?? []) as Record<string, unknown>[]).map(normOpportunity), total: Number(body.total ?? 0) };
}

export async function createOpportunity(input: {
  title: string;
  customer_id: string;
  value?: number;
  expected_close_date?: string;
  probability?: number;
  notes?: string;
}): Promise<Opportunity> {
  const r = await apiFetch(`${SVC}/opportunities`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `createOpportunity failed: ${r.status}`); }
  return normOpportunity(await r.json());
}

export async function updateOpportunity(id: string, patch: Partial<{
  stage: OpportunityStage;
  value: number;
  probability: number;
  expected_close_date: string;
  notes: string;
  title: string;
}>): Promise<Opportunity> {
  const r = await apiFetch(`${SVC}/opportunities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateOpportunity failed: ${r.status}`);
  return normOpportunity(await r.json());
}

export async function deleteOpportunity(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/opportunities/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) { const e = await r.json().catch(() => ({})); throw new Error((e as Record<string, string>).error ?? `deleteOpportunity failed: ${r.status}`); }
}
