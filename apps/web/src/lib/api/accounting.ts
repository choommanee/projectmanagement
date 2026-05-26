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

const SVC = "/api/accounting";

async function apiFetch(url: string, opts?: RequestInit): Promise<Response> {
  return fetch(url, opts);
}

// ─── types ─────────────────────────────────────────────────────────────────

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface ChartOfAccount {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  type: AccountType;
  currency: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type JEStatus = "draft" | "posted" | "void";

export interface JournalLine {
  id: string;
  entryId: string;
  lineNo: number;
  accountId: string;
  accountCode?: string;
  accountName?: string;
  debit: number;
  credit: number;
  memo: string;
}

export interface JournalEntry {
  id: string;
  tenantId: string;
  refNo: string;
  memo: string;
  entryDate: string;
  status: JEStatus;
  lines: JournalLine[];
  createdAt: string;
  updatedAt: string;
}

export type InvType = "AR" | "AP";
export type InvStatus = "draft" | "issued" | "paid" | "cancelled" | "overdue";

export interface Invoice {
  id: string;
  tenantId: string;
  invNo: string;
  invType: InvType;
  counterparty: string;
  amount: number;
  currency: string;
  status: InvStatus;
  issueDate: string;
  dueDate: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ─── normalizers ───────────────────────────────────────────────────────────

function normalizeAccount(r: Record<string, unknown>): ChartOfAccount {
  return {
    id: String(r.id ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    code: String(g(r, "code") ?? ""),
    name: String(g(r, "name") ?? ""),
    type: (g(r, "type") ?? "asset") as AccountType,
    currency: String(g(r, "currency") ?? "THB"),
    active: Boolean(g(r, "active") ?? true),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

function normalizeLine(r: Record<string, unknown>): JournalLine {
  return {
    id: String(r.id ?? ""),
    entryId: String(gid(r, "entryId", "entry_id") ?? ""),
    lineNo: Number(gid(r, "lineNo", "line_no") ?? 0),
    accountId: String(gid(r, "accountId", "account_id") ?? ""),
    accountCode: r.account_code ? String(r.account_code) : r.accountCode ? String(r.accountCode) : undefined,
    accountName: r.account_name ? String(r.account_name) : r.accountName ? String(r.accountName) : undefined,
    debit: Number(g(r, "debit") ?? 0),
    credit: Number(g(r, "credit") ?? 0),
    memo: String(g(r, "memo") ?? ""),
  };
}

function normalizeJE(r: Record<string, unknown>): JournalEntry {
  const rawLines = (r.lines ?? r.Lines) as Record<string, unknown>[] | undefined;
  return {
    id: String(r.id ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    refNo: String(gid(r, "refNo", "ref_no") ?? ""),
    memo: String(g(r, "memo") ?? ""),
    entryDate: String(gid(r, "entryDate", "entry_date") ?? ""),
    status: (g(r, "status") ?? "draft") as JEStatus,
    lines: Array.isArray(rawLines) ? rawLines.map(l => normalizeLine(l as Record<string, unknown>)) : [],
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

function normalizeInvoice(r: Record<string, unknown>): Invoice {
  return {
    id: String(r.id ?? ""),
    tenantId: String(gid(r, "tenantId", "tenant_id") ?? ""),
    invNo: String(gid(r, "invNo", "inv_no") ?? ""),
    invType: (gid(r, "invType", "inv_type") ?? "AR") as InvType,
    counterparty: String(g(r, "counterparty") ?? ""),
    amount: Number(g(r, "amount") ?? 0),
    currency: String(g(r, "currency") ?? "THB"),
    status: (g(r, "status") ?? "draft") as InvStatus,
    issueDate: String(gid(r, "issueDate", "issue_date") ?? ""),
    dueDate: String(gid(r, "dueDate", "due_date") ?? ""),
    notes: String(g(r, "notes") ?? ""),
    createdAt: String(gid(r, "createdAt", "created_at") ?? ""),
    updatedAt: String(gid(r, "updatedAt", "updated_at") ?? ""),
  };
}

// ─── financial computation helpers ────────────────────────────────────────

/**
 * Compute the net balance for one account from all journal lines touching it.
 * Debit-normal accounts (asset, expense): balance = total_debits - total_credits
 * Credit-normal accounts (liability, equity, revenue): balance = total_credits - total_debits
 */
export function computeAccountBalance(
  lines: JournalLine[],
  accountId: string,
  normalSide: "debit" | "credit",
): number {
  let debits = 0;
  let credits = 0;
  for (const l of lines) {
    if (l.accountId === accountId) {
      debits += l.debit;
      credits += l.credit;
    }
  }
  return normalSide === "debit" ? debits - credits : credits - debits;
}

/**
 * Aggregate all posted journal entry lines into a per-account debit/credit map.
 * Returns a Map keyed by accountId with { debits, credits } totals.
 */
export function groupLinesByAccount(
  entries: JournalEntry[],
): Map<string, { debits: number; credits: number }> {
  const map = new Map<string, { debits: number; credits: number }>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      const existing = map.get(line.accountId) ?? { debits: 0, credits: 0 };
      existing.debits += line.debit;
      existing.credits += line.credit;
      map.set(line.accountId, existing);
    }
  }
  return map;
}

// ─── accounts ──────────────────────────────────────────────────────────────

export async function listAccounts(params?: { q?: string; type?: AccountType }): Promise<ChartOfAccount[]> {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  if (params?.type) sp.set("type", params.type);
  const r = await apiFetch(`${SVC}/accounts${sp.toString() ? `?${sp}` : ""}`);
  if (!r.ok) throw new Error(`listAccounts: ${r.status}`);
  const data = await r.json() as unknown;
  const arr = Array.isArray(data) ? data : ((data as Record<string, unknown>).items ?? []) as unknown[];
  return (arr as Record<string, unknown>[]).map(normalizeAccount);
}

export async function createAccount(input: {
  code: string;
  name: string;
  type: AccountType;
  currency?: string;
  active?: boolean;
}): Promise<ChartOfAccount> {
  const r = await apiFetch(`${SVC}/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createAccount: ${r.status}`);
  return normalizeAccount(await r.json() as Record<string, unknown>);
}

export async function updateAccount(id: string, patch: Partial<{
  name: string;
  type: AccountType;
  currency: string;
  active: boolean;
}>): Promise<ChartOfAccount> {
  const r = await apiFetch(`${SVC}/accounts/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateAccount: ${r.status}`);
  return normalizeAccount(await r.json() as Record<string, unknown>);
}

export async function deleteAccount(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/accounts/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) throw new Error(`deleteAccount: ${r.status}`);
}

// ─── journal entries ───────────────────────────────────────────────────────

export async function listJournalEntries(params?: {
  status?: JEStatus;
  from?: string;
  to?: string;
}): Promise<{ items: JournalEntry[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.status) sp.set("status", params.status);
  if (params?.from) sp.set("from", params.from);
  if (params?.to) sp.set("to", params.to);
  const r = await apiFetch(`${SVC}/journal-entries${sp.toString() ? `?${sp}` : ""}`);
  if (!r.ok) throw new Error(`listJournalEntries: ${r.status}`);
  const data = await r.json() as unknown;
  if (Array.isArray(data)) return { items: (data as Record<string, unknown>[]).map(normalizeJE), total: data.length };
  const obj = data as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normalizeJE) : [];
  return { items, total: Number(obj.total ?? items.length) };
}

export async function createJournalEntry(input: {
  ref_no?: string;
  memo?: string;
  entry_date?: string;
}): Promise<JournalEntry> {
  const r = await apiFetch(`${SVC}/journal-entries`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createJournalEntry: ${r.status}`);
  return normalizeJE(await r.json() as Record<string, unknown>);
}

export async function getJournalEntry(id: string): Promise<JournalEntry> {
  const r = await apiFetch(`${SVC}/journal-entries/${id}`);
  if (!r.ok) throw new Error(`getJournalEntry: ${r.status}`);
  return normalizeJE(await r.json() as Record<string, unknown>);
}

export async function postJournalEntry(id: string): Promise<JournalEntry> {
  const r = await apiFetch(`${SVC}/journal-entries/${id}/post`, { method: "POST" });
  if (!r.ok) throw new Error(`postJournalEntry: ${r.status}`);
  return normalizeJE(await r.json() as Record<string, unknown>);
}

export async function addJELine(entryId: string, line: {
  account_id: string;
  debit?: number;
  credit?: number;
  memo?: string;
}): Promise<JournalLine> {
  const r = await apiFetch(`${SVC}/journal-entries/${entryId}/lines`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(line),
  });
  if (!r.ok) throw new Error(`addJELine: ${r.status}`);
  return normalizeLine(await r.json() as Record<string, unknown>);
}

export async function updateJELine(entryId: string, lineId: string, patch: Partial<{
  debit: number;
  credit: number;
  memo: string;
}>): Promise<JournalLine> {
  const r = await apiFetch(`${SVC}/journal-entries/${entryId}/lines/${lineId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateJELine: ${r.status}`);
  return normalizeLine(await r.json() as Record<string, unknown>);
}

export async function deleteJELine(entryId: string, lineId: string): Promise<void> {
  const r = await apiFetch(`${SVC}/journal-entries/${entryId}/lines/${lineId}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) throw new Error(`deleteJELine: ${r.status}`);
}

// ─── invoices ──────────────────────────────────────────────────────────────

export async function listInvoices(params?: {
  type?: InvType;
  status?: InvStatus;
}): Promise<{ items: Invoice[]; total: number }> {
  const sp = new URLSearchParams();
  if (params?.type) sp.set("type", params.type);
  if (params?.status) sp.set("status", params.status);
  const r = await apiFetch(`${SVC}/invoices${sp.toString() ? `?${sp}` : ""}`);
  if (!r.ok) throw new Error(`listInvoices: ${r.status}`);
  const data = await r.json() as unknown;
  if (Array.isArray(data)) return { items: (data as Record<string, unknown>[]).map(normalizeInvoice), total: data.length };
  const obj = data as Record<string, unknown>;
  const items = Array.isArray(obj.items) ? (obj.items as Record<string, unknown>[]).map(normalizeInvoice) : [];
  return { items, total: Number(obj.total ?? items.length) };
}

export async function getInvoice(id: string): Promise<Invoice> {
  const r = await apiFetch(`${SVC}/invoices/${id}`);
  if (!r.ok) throw new Error(`getInvoice: ${r.status}`);
  return normalizeInvoice(await r.json() as Record<string, unknown>);
}

export async function createInvoice(input: {
  inv_type: InvType;
  counterparty: string;
  amount: number;
  currency?: string;
  issue_date?: string;
  due_date?: string;
  notes?: string;
}): Promise<Invoice> {
  const r = await apiFetch(`${SVC}/invoices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createInvoice: ${r.status}`);
  return normalizeInvoice(await r.json() as Record<string, unknown>);
}

export async function updateInvoice(id: string, patch: Partial<{
  counterparty: string;
  amount: number;
  currency: string;
  status: InvStatus;
  due_date: string;
  notes: string;
}>): Promise<Invoice> {
  const r = await apiFetch(`${SVC}/invoices/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`updateInvoice: ${r.status}`);
  return normalizeInvoice(await r.json() as Record<string, unknown>);
}

export async function deleteInvoice(id: string): Promise<void> {
  const r = await apiFetch(`${SVC}/invoices/${id}`, { method: "DELETE" });
  if (!r.ok && r.status !== 204) throw new Error(`deleteInvoice: ${r.status}`);
}
