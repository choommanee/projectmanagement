import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listAccounts, createAccount, updateAccount, deleteAccount,
  listInvoices, createInvoice, updateInvoice, deleteInvoice,
  addJELine, listJournalEntries, groupLinesByAccount, computeAccountBalance,
  type JournalEntry,
} from "./accounting";

function mockOnce(body: unknown, ok = true, status = 200) {
  (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok, status, json: async () => body, text: async () => JSON.stringify(body),
  });
}
function lastCall() {
  const calls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls;
  const [url, opts] = calls[calls.length - 1] as [string, RequestInit | undefined];
  return { url, opts, body: opts?.body ? JSON.parse(opts.body as string) : undefined };
}

beforeEach(() => { global.fetch = vi.fn(); });

describe("accounting API client — PascalCase + field mapping", () => {
  it("normalizeAccount reads PascalCase ID/AccountType/Version", async () => {
    mockOnce({ items: [{ ID: "a-1", TenantID: "t-1", Code: "1000", Name: "Cash", AccountType: "asset", Currency: "THB", Active: true, Version: 4 }], total: 1 });
    const accts = await listAccounts();
    expect(accts[0].id).toBe("a-1");
    expect(accts[0].type).toBe("asset");
    expect(accts[0].version).toBe(4);
  });

  it("createAccount sends account_type (not type)", async () => {
    mockOnce({ ID: "a-2", Code: "2000", Name: "AP", AccountType: "liability", Version: 1 });
    await createAccount({ code: "2000", name: "AP", type: "liability" });
    const { body } = lastCall();
    expect(body.account_type).toBe("liability");
    expect(body.type).toBeUndefined();
  });

  it("updateAccount sends account_type + version", async () => {
    mockOnce({ ID: "a-2", AccountType: "asset", Version: 3 });
    await updateAccount("a-2", { name: "X", type: "asset", version: 2 });
    const { body } = lastCall();
    expect(body.account_type).toBe("asset");
    expect(body.version).toBe(2);
  });

  it("deleteAccount appends ?version=", async () => {
    mockOnce(null, true, 204);
    await deleteAccount("a-2", 5);
    expect(lastCall().url).toContain("/accounts/a-2?version=5");
  });

  it("normalizeInvoice uppercases inv_type and maps CounterpartyID", async () => {
    mockOnce({ items: [{ ID: "i-1", InvNo: "AR-1", InvType: "ar", CounterpartyID: "c-9", Amount: 100, Status: "draft", Version: 2 }], total: 1 });
    const { items } = await listInvoices({ type: "AR" });
    expect(items[0].invType).toBe("AR");
    expect(items[0].counterpartyId).toBe("c-9");
    expect(items[0].version).toBe(2);
  });

  it("createInvoice sends lowercase inv_type + counterparty_id + inv_no", async () => {
    mockOnce({ ID: "i-2", InvType: "ap", CounterpartyID: "c-1", Version: 1 });
    await createInvoice({ inv_type: "AP", counterparty_id: "c-1", amount: 50 });
    const { body } = lastCall();
    expect(body.inv_type).toBe("ap");
    expect(body.counterparty_id).toBe("c-1");
    expect(typeof body.inv_no).toBe("string");
  });

  it("updateInvoice forwards version; deleteInvoice appends ?version=", async () => {
    mockOnce({ ID: "i-2", InvType: "ar", Version: 3 });
    await updateInvoice("i-2", { status: "issued", version: 2 });
    expect(lastCall().body.version).toBe(2);
    mockOnce(null, true, 204);
    await deleteInvoice("i-2", 3);
    expect(lastCall().url).toContain("/invoices/i-2?version=3");
  });

  it("addJELine maps memo -> description; normalizeLine reads Description", async () => {
    mockOnce({ ID: "l-1", AccountID: "a-1", Debit: 10, Credit: 0, Description: "cash in", LineNo: 1 });
    const line = await addJELine("e-1", { account_id: "a-1", debit: 10, memo: "cash in" });
    expect(lastCall().body.description).toBe("cash in");
    expect(lastCall().body.memo).toBeUndefined();
    expect(line.memo).toBe("cash in");
  });

  it("updateInvoice stamps paid_at only when transitioning to paid", async () => {
    mockOnce({ ID: "i-3", InvType: "ar", Status: "paid", Version: 3 });
    await updateInvoice("i-3", { status: "paid", paid_at: "2026-06-07T00:00:00Z", version: 2 });
    expect(lastCall().body.paid_at).toBe("2026-06-07T00:00:00Z");
    expect(lastCall().body.status).toBe("paid");
  });

  it("listJournalEntries normalizes PascalCase Lines from the list response", async () => {
    mockOnce({
      items: [{
        ID: "e-1", RefNo: "JE-1", Status: "posted", EntryDate: "2026-06-01",
        lines: [
          { ID: "l-1", AccountID: "a-1", Debit: 1000, Credit: 0, LineNo: 1 },
          { ID: "l-2", AccountID: "a-2", Debit: 0, Credit: 1000, LineNo: 2 },
        ],
      }],
      total: 1,
    });
    const { items } = await listJournalEntries({ status: "posted" });
    expect(items[0].lines).toHaveLength(2);
    expect(items[0].lines[0].debit).toBe(1000);
    expect(items[0].lines[1].credit).toBe(1000);
  });
});

describe("accounting financial helpers — trial balance math", () => {
  const entries: JournalEntry[] = [
    {
      id: "e-1", tenantId: "t", refNo: "JE-1", memo: "", entryDate: "2026-06-01",
      status: "posted", createdAt: "", updatedAt: "",
      lines: [
        { id: "l1", entryId: "e-1", lineNo: 1, accountId: "cash", debit: 1000, credit: 0, memo: "" },
        { id: "l2", entryId: "e-1", lineNo: 2, accountId: "rev", debit: 0, credit: 1000, memo: "" },
      ],
    },
    {
      id: "e-2", tenantId: "t", refNo: "JE-2", memo: "", entryDate: "2026-06-02",
      status: "posted", createdAt: "", updatedAt: "",
      lines: [
        { id: "l3", entryId: "e-2", lineNo: 1, accountId: "cash", debit: 0, credit: 250, memo: "" },
        { id: "l4", entryId: "e-2", lineNo: 2, accountId: "exp", debit: 250, credit: 0, memo: "" },
      ],
    },
  ];

  it("groupLinesByAccount aggregates debits/credits per account", () => {
    const m = groupLinesByAccount(entries);
    expect(m.get("cash")).toEqual({ debits: 1000, credits: 250 });
    expect(m.get("rev")).toEqual({ debits: 0, credits: 1000 });
    expect(m.get("exp")).toEqual({ debits: 250, credits: 0 });
  });

  it("trial balance: total debits equal total credits", () => {
    const m = groupLinesByAccount(entries);
    let d = 0, c = 0;
    for (const { debits, credits } of m.values()) { d += debits; c += credits; }
    expect(d).toBe(c);
    expect(d).toBe(1250);
  });

  it("computeAccountBalance respects normal side", () => {
    const lines = entries.flatMap((e) => e.lines);
    expect(computeAccountBalance(lines, "cash", "debit")).toBe(750);   // 1000 - 250
    expect(computeAccountBalance(lines, "rev", "credit")).toBe(1000);  // 1000 - 0
    expect(computeAccountBalance(lines, "exp", "debit")).toBe(250);
  });
});
