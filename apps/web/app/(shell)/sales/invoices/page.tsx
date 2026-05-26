"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listSalesInvoices,
  createSalesInvoice,
  updateInvoiceStatus,
  listCustomers,
  type SalesInvoice,
  type InvoiceStatus,
  type Customer,
} from "@/lib/api/sales";

const STATUS_OPTS = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
];

function statusTone(s: string): "neutral" | "info" | "success" | "danger" | "warning" {
  if (s === "draft") return "neutral";
  if (s === "sent") return "info";
  if (s === "paid") return "success";
  if (s === "overdue") return "danger";
  if (s === "cancelled") return "warning";
  return "neutral";
}

function fmt(n?: number) {
  return n != null ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n) : "—";
}

function NewInvoiceDialog({
  open,
  customers,
  onClose,
  onCreated,
}: {
  open: boolean;
  customers: Customer[];
  onClose: () => void;
  onCreated: (inv: SalesInvoice) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ customer_id: "", issue_date: today, due_date: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ customer_id: customers[0]?.id ?? "", issue_date: today, due_date: "", notes: "" });
      setError(null);
    }
  }, [open, customers, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer_id) {
      setError("Customer required");
      return;
    }
    setLoading(true);
    try {
      const inv = await createSalesInvoice({
        customer_id: form.customer_id,
        issue_date: form.issue_date,
        due_date: form.due_date || undefined,
        notes: form.notes || undefined,
      });
      onCreated(inv);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Invoice">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[360px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Customer *</span>
          <select
            value={form.customer_id}
            onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Issue Date</span>
          <Input
            type="date"
            value={form.issue_date}
            onChange={(e) => setForm((f) => ({ ...f, issue_date: e.target.value }))}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Due Date</span>
          <Input
            type="date"
            value={form.due_date}
            onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Notes</span>
          <Input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Reference, terms…"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create Invoice"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function SalesInvoicesPage() {
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      listSalesInvoices(statusFilter ? { status: statusFilter } : undefined),
      listCustomers(),
    ])
      .then(([ir, cr]) => {
        setInvoices(ir.status === "fulfilled" ? ir.value : []);
        setCustomers(cr.status === "fulfilled" ? cr.value : []);
      })
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function markAs(id: string, status: InvoiceStatus) {
    setProcessing(id);
    try {
      await updateInvoiceStatus(id, status);
      load();
    } finally {
      setProcessing(null);
    }
  }

  const totalOutstanding = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((s, i) => s + (i.total ?? 0), 0);

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Sales", href: "/sales/home" }, { label: "Invoices" }]} />
      <CommandBar
        actions={[
          { id: "new", label: "+ New Invoice", variant: "primary", onClick: () => setNewOpen(true) },
          { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
        ]}
      />

      <div className="flex items-center gap-3 flex-wrap">
        {STATUS_OPTS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
              statusFilter === opt.value
                ? "bg-accent text-white"
                : "bg-surface-2 text-ink hover:bg-surface-3"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-sm text-ink-muted">
          Outstanding:{" "}
          <span className="font-mono font-semibold text-ink">{fmt(totalOutstanding)}</span>
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Code</th>
                <th className="px-4 py-2 text-left font-medium">Customer</th>
                <th className="px-4 py-2 text-left font-medium">Issued</th>
                <th className="px-4 py-2 text-left font-medium">Due</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-muted">
                    No invoices found.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2 font-mono text-xs">{inv.code ?? inv.id.slice(0, 8)}</td>
                    <td className="px-4 py-2 font-medium">
                      {inv.customer_name ?? inv.customer_id}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">
                      {new Date(inv.issue_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">
                      {inv.due_date ? new Date(inv.due_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">
                      {fmt(inv.total)}
                    </td>
                    <td className="px-4 py-2">
                      <Tag tone={statusTone(inv.status)} size="sm">
                        {inv.status}
                      </Tag>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        {inv.status === "draft" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => markAs(inv.id, "sent")}
                            disabled={processing === inv.id}
                          >
                            Send
                          </Button>
                        )}
                        {(inv.status === "sent" || inv.status === "overdue") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => markAs(inv.id, "paid")}
                            disabled={processing === inv.id}
                          >
                            Mark Paid
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <NewInvoiceDialog
        open={newOpen}
        customers={customers}
        onClose={() => setNewOpen(false)}
        onCreated={(inv) => {
          setInvoices((p) => [inv, ...p]);
          setNewOpen(false);
        }}
      />
    </div>
  );
}
