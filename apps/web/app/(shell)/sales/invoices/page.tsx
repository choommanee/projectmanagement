"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listSalesInvoices,
  createSalesInvoice,
  updateInvoiceStatus,
  updateInvoice,
  deleteSalesInvoice,
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

const EDITABLE_STATUSES: InvoiceStatus[] = ["draft", "sent", "paid", "overdue", "cancelled"];

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

function EditInvoiceDialog({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: SalesInvoice | null;
  onClose: () => void;
  onSaved: (inv: SalesInvoice) => void;
}) {
  const [form, setForm] = useState({ status: "draft" as InvoiceStatus, due_date: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (invoice) {
      setForm({
        status: invoice.status,
        due_date: invoice.due_date ? invoice.due_date.split("T")[0] : "",
        notes: invoice.notes ?? "",
      });
      setError(null);
    }
  }, [invoice]);

  if (!invoice) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoice) return;
    setLoading(true);
    setError(null);
    try {
      // Fetch current version
      const cur = await fetch(`/api/sales/invoices/${invoice.id}`).then(r => r.json()) as Record<string, unknown>;
      const version = (cur.Version ?? cur.version ?? 1) as number;
      const updated = await updateInvoice(invoice.id, {
        status: form.status,
        due_date: form.due_date || undefined,
        notes: form.notes || undefined,
        version,
      });
      onSaved({ ...invoice, ...updated });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!invoice} onClose={onClose} title="Edit Invoice">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[360px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as InvoiceStatus }))}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {EDITABLE_STATUSES.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
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
            {loading ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function SalesInvoicesPage() {
  const router = useRouter();
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState<SalesInvoice | null>(null);
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

  async function handleDelete(id: string) {
    if (!confirm("Delete this invoice? It will be marked as cancelled.")) return;
    setProcessing(id);
    try {
      await deleteSalesInvoice(id);
      setInvoices((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      alert(`Delete failed: ${err}`);
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
                : "bg-surface-2 text-ink hover:bg-surface-2"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <span className="ml-auto text-sm text-ink-3">
          Outstanding:{" "}
          <span className="font-mono font-semibold text-ink">{fmt(totalOutstanding)}</span>
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-3">
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
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-3">
                    No invoices found.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-surface-2/50 cursor-pointer" onClick={() => router.push('/sales/invoices/' + inv.id)}>
                    <td className="px-4 py-2 font-mono text-xs">{inv.code ?? inv.id.slice(0, 8)}</td>
                    <td className="px-4 py-2 font-medium">
                      {inv.customer_name ?? inv.customer_id}
                    </td>
                    <td className="px-4 py-2 text-ink-3">
                      {new Date(inv.issue_date).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2 text-ink-3">
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
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 flex-wrap">
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
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditInvoice(inv)}
                          disabled={processing === inv.id}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(inv.id)}
                          disabled={processing === inv.id}
                        >
                          <span className="text-danger">Del</span>
                        </Button>
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

      <EditInvoiceDialog
        invoice={editInvoice}
        onClose={() => setEditInvoice(null)}
        onSaved={(updated) => {
          setInvoices((prev) => prev.map((i) => i.id === updated.id ? updated : i));
          setEditInvoice(null);
        }}
      />
    </div>
  );
}
