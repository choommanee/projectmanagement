"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listInvoices, createInvoice, updateInvoice, deleteInvoice,
  type Invoice, type InvType, type InvStatus,
} from "@/lib/api/accounting";

const INV_STATUSES: { value: InvStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "issued", label: "Issued" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "cancelled", label: "Cancelled" },
];

function statusTone(s: InvStatus): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "draft")     return "neutral";
  if (s === "issued")    return "info";
  if (s === "paid")      return "success";
  if (s === "overdue")   return "warning";
  if (s === "cancelled") return "danger";
  return "neutral";
}

type FormData = {
  counterparty: string;
  amount: string;
  currency: string;
  issue_date: string;
  due_date: string;
  notes: string;
};

const EMPTY: FormData = {
  counterparty: "", amount: "0", currency: "THB",
  issue_date: new Date().toISOString().split("T")[0],
  due_date: "", notes: "",
};

function InvoiceDialog({
  open, invType, onClose, onCreated,
}: {
  open: boolean;
  invType: InvType;
  onClose: () => void;
  onCreated: (inv: Invoice) => void;
}) {
  const [form, setForm] = useState<FormData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setForm(EMPTY); setError(null); }
  }, [open]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.counterparty) { setError("Counterparty is required."); return; }
    setLoading(true);
    setError(null);
    try {
      const inv = await createInvoice({
        inv_type: invType,
        counterparty: form.counterparty,
        amount: Number(form.amount) || 0,
        currency: form.currency || "THB",
        issue_date: form.issue_date || undefined,
        due_date: form.due_date || undefined,
        notes: form.notes,
      });
      onCreated(inv);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setLoading(false);
    }
  }

  const f = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`New ${invType === "AR" ? "Receivable" : "Payable"} Invoice`}
      description={`Create a new ${invType} invoice`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>Create Invoice</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">
            {invType === "AR" ? "Customer / Counterparty" : "Vendor / Counterparty"} *
          </label>
          <Input value={form.counterparty} onChange={f("counterparty")} placeholder="Counterparty name" required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Amount</label>
            <Input type="number" min="0" step="0.01" value={form.amount} onChange={f("amount")} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Currency</label>
            <Input value={form.currency} onChange={f("currency")} placeholder="THB" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Issue Date</label>
            <Input type="date" value={form.issue_date} onChange={f("issue_date")} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Due Date</label>
            <Input type="date" value={form.due_date} onChange={f("due_date")} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Notes</label>
          <Input value={form.notes} onChange={f("notes")} placeholder="Optional notes" />
        </div>
      </form>
    </Dialog>
  );
}

export default function InvoicesPage() {
  const router = useRouter();
  const [invType, setInvType] = useState<InvType>("AR");
  const [statusFilter, setStatusFilter] = useState<InvStatus | "">("");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listInvoices({ type: invType, status: statusFilter || undefined });
      setInvoices(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load invoices");
    } finally {
      setLoading(false);
    }
  }, [invType, statusFilter]);

  useEffect(() => { void load(); }, [invType, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function transition(inv: Invoice, status: InvStatus) {
    setTransitioning(inv.id);
    try {
      const updated = await updateInvoice(inv.id, { status });
      setInvoices(prev => {
        const idx = prev.findIndex(x => x.id === updated.id);
        if (idx >= 0) { const n = [...prev]; n[idx] = updated; return n; }
        return prev;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update invoice");
    } finally {
      setTransitioning(null);
    }
  }

  async function handleDelete(inv: Invoice) {
    if (!confirm(`Delete invoice ${inv.invNo || inv.id.slice(0, 8)}?`)) return;
    try {
      await deleteInvoice(inv.id);
      setInvoices(prev => prev.filter(x => x.id !== inv.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete invoice");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Accounting Hub", href: "/accounting/home" }, { label: "Billing" }, { label: "Invoices" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Invoice", variant: "primary", onClick: () => setDialogOpen(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      {/* Type tabs + status filters */}
      <div className="flex items-center gap-4 border-b border-line bg-paper px-4 py-2">
        {(["AR", "AP"] as InvType[]).map(t => (
          <button
            key={t}
            onClick={() => { setInvType(t); setStatusFilter(""); }}
            className={`rounded-xs px-4 py-1.5 text-xs font-semibold transition-colors ${invType === t ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}
          >
            {t === "AR" ? "Accounts Receivable (AR)" : "Accounts Payable (AP)"}
          </button>
        ))}
        <span className="mx-2 text-ink-3">|</span>
        {INV_STATUSES.map(s => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === s.value ? "bg-surface-2 font-semibold text-ink" : "text-ink-3 hover:bg-surface-2 hover:text-ink"}`}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-3">{total} invoices</span>
      </div>

      {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      <div className="min-h-0 flex-1 overflow-auto">
        {loading && !invoices.length ? (
          <div className="space-y-px">
            {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Inv No</th>
                <th className="px-4 py-2">Counterparty</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Currency</th>
                <th className="px-4 py-2 text-center">Status</th>
                <th className="px-4 py-2">Issue Date</th>
                <th className="px-4 py-2">Due Date</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-line hover:bg-surface-2 cursor-pointer" onClick={() => router.push('/accounting/invoices/' + inv.id)}>
                  <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{inv.invNo || inv.id.slice(0, 8)}</td>
                  <td className="px-4 py-2 font-medium text-ink">{inv.counterparty}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-ink">
                    {inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-2">{inv.currency}</td>
                  <td className="px-4 py-2 text-center">
                    <Tag tone={statusTone(inv.status)}>{inv.status}</Tag>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-2">
                    {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-2">
                    {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {inv.status === "draft" && (
                        <button
                          onClick={() => void transition(inv, "issued")}
                          disabled={transitioning === inv.id}
                          className="rounded-xs border border-info px-2 py-0.5 text-xs text-info hover:bg-info/10 disabled:opacity-50"
                        >
                          Issue
                        </button>
                      )}
                      {inv.status === "issued" && (
                        <button
                          onClick={() => void transition(inv, "paid")}
                          disabled={transitioning === inv.id}
                          className="rounded-xs border border-success px-2 py-0.5 text-xs text-success hover:bg-success/10 disabled:opacity-50"
                        >
                          Mark Paid
                        </button>
                      )}
                      {(inv.status === "draft" || inv.status === "issued") && (
                        <button
                          onClick={() => void transition(inv, "cancelled")}
                          disabled={transitioning === inv.id}
                          className="rounded-xs border border-danger px-2 py-0.5 text-xs text-danger hover:bg-danger/10 disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      )}
                      {inv.status === "draft" && (
                        <button
                          onClick={() => void handleDelete(inv)}
                          className="rounded-xs px-2 py-0.5 text-xs text-ink-3 hover:bg-danger/10 hover:text-danger"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && invoices.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-ink-3">
                    No {invType} invoices found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <InvoiceDialog
        open={dialogOpen}
        invType={invType}
        onClose={() => setDialogOpen(false)}
        onCreated={(inv) => {
          setDialogOpen(false);
          setInvoices(prev => [inv, ...prev]);
        }}
      />
    </div>
  );
}
