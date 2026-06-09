"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { getInvoice, updateInvoice, type Invoice, type InvStatus, type InvType } from "@/lib/api/accounting";
import { getCustomer } from "@/lib/api/sales";

const STATUS_FLOW_AR: InvStatus[] = ["draft", "issued", "paid"];
const STATUS_FLOW_AP: InvStatus[] = ["draft", "issued", "paid"];
const STATUS_COLORS: Record<InvStatus, string> = {
  draft: "bg-surface-2 text-ink-3",
  issued: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-zinc-200 text-zinc-500",
};
const TYPE_COLORS: Record<InvType, string> = {
  AR: "bg-indigo-100 text-indigo-700",
  AP: "bg-amber-100 text-amber-700",
};

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [counterpartyLabel, setCounterpartyLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getInvoice(id).then((inv) => {
      setInvoice(inv);
      if (inv.counterpartyName) {
        setCounterpartyLabel(inv.counterpartyName);
      } else if (inv.counterpartyId) {
        setCounterpartyLabel(inv.counterpartyId);
        getCustomer(inv.counterpartyId).then(c => setCounterpartyLabel(c.name)).catch(() => {});
      }
    }).finally(() => setLoading(false));
  }, [id]);

  async function advance() {
    if (!invoice) return;
    const flow = STATUS_FLOW_AR;
    const idx = flow.indexOf(invoice.status);
    if (idx < 0 || idx >= flow.length - 1) return;
    setSaving(true);
    const updated = await updateInvoice(invoice.id, { status: flow[idx + 1], version: invoice.version }).catch(() => null);
    if (updated) setInvoice(updated);
    setSaving(false);
  }

  async function cancel() {
    if (!invoice) return;
    setSaving(true);
    const updated = await updateInvoice(invoice.id, { status: "cancelled", version: invoice.version }).catch(() => null);
    if (updated) setInvoice(updated);
    setSaving(false);
  }

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!invoice) return <div className="p-6 text-sm text-red-600">Invoice not found</div>;

  const flow = STATUS_FLOW_AR;
  const canAdvance = flow.includes(invoice.status) && invoice.status !== "paid";
  const isOverdue = invoice.status !== "paid" && invoice.status !== "cancelled" && invoice.dueDate && new Date(invoice.dueDate) < new Date();

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Accounting" }, { label: "Invoices", href: "/accounting/invoices" }, { label: invoice.invNo }]} />

      {/* Header */}
      <div className="rounded-lg border border-line bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold font-mono">{invoice.invNo}</h1>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[invoice.invType]}`}>{invoice.invType}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isOverdue ? STATUS_COLORS.overdue : STATUS_COLORS[invoice.status]}`}>
              {isOverdue ? "overdue" : invoice.status}
            </span>
          </div>
          <div className="text-sm text-ink-3 space-y-0.5">
            <div className="font-medium text-foreground">{counterpartyLabel}</div>
            <div>Issued: {invoice.issueDate?.slice(0, 10)}</div>
            {invoice.dueDate && <div className={isOverdue ? "text-red-600 font-medium" : ""}>Due: {invoice.dueDate.slice(0, 10)}</div>}
            {invoice.notes && <div className="text-xs mt-1">{invoice.notes}</div>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {canAdvance && (
            <button onClick={advance} disabled={saving} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              → {flow[flow.indexOf(invoice.status) + 1]}
            </button>
          )}
          {invoice.status === "draft" && (
            <button onClick={cancel} disabled={saving} className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">
              Cancel
            </button>
          )}
          <button onClick={() => router.back()} className="px-3 py-1.5 text-xs rounded border border-line text-ink-3 hover:text-ink">← Back</button>
        </div>
      </div>

      {/* Amount card */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Amount</div>
          <div className="text-2xl font-mono font-bold">{fmt(invoice.amount)}</div>
          <div className="text-xs text-ink-3 mt-1">{invoice.currency}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Type</div>
          <div className="text-2xl font-mono font-bold">{invoice.invType}</div>
          <div className="text-xs text-ink-3 mt-1">{invoice.invType === "AR" ? "Accounts Receivable" : "Accounts Payable"}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Status</div>
          <div className={`text-2xl font-mono font-bold ${invoice.status === "paid" ? "text-green-600" : isOverdue ? "text-red-600" : ""}`}>
            {isOverdue ? "OVERDUE" : invoice.status.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="rounded-lg border border-line bg-surface p-5 grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-ink-3">Invoice #:</span> <span className="font-mono">{invoice.invNo}</span></div>
        <div><span className="text-ink-3">Counterparty:</span> {counterpartyLabel}</div>
        <div><span className="text-ink-3">Issue Date:</span> {invoice.issueDate?.slice(0, 10)}</div>
        <div><span className="text-ink-3">Due Date:</span> <span className={isOverdue ? "text-red-600 font-medium" : ""}>{invoice.dueDate?.slice(0, 10) ?? "—"}</span></div>
        <div><span className="text-ink-3">Currency:</span> {invoice.currency}</div>
        <div><span className="text-ink-3">Amount:</span> <span className="font-mono font-semibold">{fmt(invoice.amount)}</span></div>
        {invoice.notes && <div className="col-span-2"><span className="text-ink-3">Notes:</span> {invoice.notes}</div>}
      </div>
    </div>
  );
}
