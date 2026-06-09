import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listCustomers, updateCustomer, deleteCustomer,
  listSalesOrders, createSalesInvoice,
} from "./sales";

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

describe("sales API client — version + PascalCase mapping", () => {
  it("normCustomer reads PascalCase ID + Version", async () => {
    mockOnce({ items: [{ ID: "c-1", Code: "CUST-1", Name: "Acme", Active: true, Version: 7 }], total: 1 });
    const custs = await listCustomers();
    expect(custs[0].id).toBe("c-1");
    expect(custs[0].version).toBe(7);
  });

  it("updateCustomer forwards version in body", async () => {
    mockOnce({ ID: "c-1", Name: "Acme2", Version: 8 });
    await updateCustomer("c-1", { name: "Acme2", version: 7 });
    expect(lastCall().body.version).toBe(7);
  });

  it("deleteCustomer appends ?version= and sends destructive header", async () => {
    mockOnce(null, true, 204);
    await deleteCustomer("c-1", 8);
    const { url, opts } = lastCall();
    expect(url).toContain("/customers/c-1?version=8");
    expect((opts?.headers as Record<string, string>)["X-Confirm-Destructive"]).toBe("true");
  });

  it("normSalesOrder reads SONumber", async () => {
    mockOnce({ items: [{ ID: "so-1", SONumber: "SO-000009", CustomerID: "c-1", Status: "draft" }], total: 1 });
    const { items } = await listSalesOrders();
    expect(items[0].soNumber).toBe("SO-000009");
  });

  it("createSalesInvoice passes amounts and normalizes Total", async () => {
    mockOnce({ ID: "inv-1", Code: "INV-000001", CustomerID: "c-1", IssueDate: "2026-06-07", Status: "draft", Subtotal: 500, Tax: 35, Total: 535 });
    const inv = await createSalesInvoice({ customer_id: "c-1", issue_date: "2026-06-07", subtotal: 500, tax: 35 });
    expect(lastCall().body.subtotal).toBe(500);
    expect(lastCall().body.tax).toBe(35);
    expect(inv.total).toBe(535);
    expect(inv.code).toBe("INV-000001");
  });
});
