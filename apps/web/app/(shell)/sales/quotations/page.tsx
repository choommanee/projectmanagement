"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listQuotes, createQuote, updateQuoteStatus, listCustomers, convertQuoteToOrder,
  type Quote, type QuoteStatus, type Customer,
} from "@/lib/api/sales";

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "expired", label: "Expired" },
];

function statusTone(s: string): "neutral" | "info" | "accent" | "success" | "danger" | "warning" {
  if (s === "draft") return "neutral";
  if (s === "sent") return "info";
  if (s === "accepted") return "success";
  if (s === "rejected") return "danger";
  if (s === "expired") return "warning";
  return "neutral";
}

function fmt(n?: number): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n);
}

function NewQuoteDialog({
  open, customers, onClose, onCreated,
}: {
  open: boolean;
  customers: Customer[];
  onClose: () => void;
  onCreated: (q: Quote) => void;
}) {
  const [form, setForm] = useState({ customer_id: "", title: "", valid_until: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ customer_id: customers[0]?.id ?? "", title: "", valid_until: "", notes: "" });
      setError(null);
    }
  }, [open, customers]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.customer_id) { setError("Customer is required."); return; }
    setLoading(true);
    try {
      const q = await createQuote({
        customer_id: form.customer_id,
        title: form.title || undefined,
        valid_until: form.valid_until || undefined,
        notes: form.notes || undefined,
        status: "draft",
      });
      onCreated(q);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Quotation">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Customer *</span>
          <select
            value={form.customer_id}
            onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Title</span>
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Quote title…" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Valid Until</span>
          <Input type="date" value={form.valid_until} onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Notes</span>
          <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Internal notes…" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create Quote"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function SalesQuotationsPage() {
  const router = useRouter();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      listQuotes(statusFilter ? { status: statusFilter } : undefined),
      listCustomers(),
    ]).then(([qr, cr]) => {
      setQuotes(qr.status === "fulfilled" ? qr.value : []);
      setCustomers(cr.status === "fulfilled" ? cr.value : []);
    }).finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function updateStatus(id: string, status: QuoteStatus) {
    setProcessing(id);
    try { await updateQuoteStatus(id, status); load(); } finally { setProcessing(null); }
  }

  async function handleConvert(id: string) {
    setProcessing(id);
    try {
      await convertQuoteToOrder(id);
      router.push("/sales/orders");
    } catch (err) {
      alert(`Failed to convert: ${err}`);
    } finally { setProcessing(null); }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Sales", href: "/sales/home" }, { label: "Quotations" }]} />
      <CommandBar actions={[{
        id: "new", label: "New Quote", onClick: () => setNewOpen(true),
      }]} />

      <div className="flex gap-2 flex-wrap">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`rounded px-3 py-1 text-sm font-medium transition-colors ${statusFilter === opt.value ? "bg-accent text-white" : "bg-surface-2 text-ink hover:bg-surface-3"}`}
          >
            {opt.label}
          </button>
        ))}
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
                <th className="px-4 py-2 text-left font-medium">Title</th>
                <th className="px-4 py-2 text-left font-medium">Valid Until</th>
                <th className="px-4 py-2 text-right font-medium">Total</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {quotes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-3">No quotations found.</td>
                </tr>
              ) : quotes.map((q) => (
                <tr key={q.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-mono text-xs text-ink-3">{q.code ?? q.id.slice(0, 8)}</td>
                  <td className="px-4 py-2 font-medium">{q.customer_name ?? q.customer_id}</td>
                  <td className="px-4 py-2 text-ink-3">{q.title ?? "—"}</td>
                  <td className="px-4 py-2 text-ink-3">
                    {q.valid_until ? new Date(q.valid_until).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{fmt(q.total_amount)}</td>
                  <td className="px-4 py-2">
                    <Tag tone={statusTone(q.status)} size="sm">{q.status}</Tag>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      {q.status === "draft" && (
                        <Button size="sm" variant="ghost" onClick={() => updateStatus(q.id, "sent")} disabled={processing === q.id}>
                          Send
                        </Button>
                      )}
                      {q.status === "sent" && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => updateStatus(q.id, "accepted")} disabled={processing === q.id}>
                            Accept
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => updateStatus(q.id, "rejected")} disabled={processing === q.id}>
                            Reject
                          </Button>
                        </>
                      )}
                      {q.status === "accepted" && (
                        <Button size="sm" variant="primary" onClick={() => handleConvert(q.id)} disabled={processing === q.id}>
                          Convert to SO
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewQuoteDialog
        open={newOpen}
        customers={customers}
        onClose={() => setNewOpen(false)}
        onCreated={(q) => { setQuotes((prev) => [q, ...prev]); setNewOpen(false); }}
      />
    </div>
  );
}
