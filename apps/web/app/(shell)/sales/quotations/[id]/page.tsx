"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getQuote, updateQuoteStatus, getCustomer,
  type Quote, type QuoteStatus, type Customer,
} from "@/lib/api/sales";

const STATUS_COLORS: Record<QuoteStatus, string> = {
  draft: "bg-surface-2 text-ink-3",
  sent: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-600",
  expired: "bg-zinc-200 text-zinc-500",
};

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getQuote(id).then(q => {
      setQuote(q);
      if (q.customer_id) return getCustomer(q.customer_id).then(setCustomer).catch(() => null);
    }).finally(() => setLoading(false));
  }, [id]);

  async function changeStatus(status: QuoteStatus) {
    if (!quote) return;
    setSaving(true);
    await updateQuoteStatus(quote.id, status).catch(() => null);
    setQuote(prev => prev ? { ...prev, status } : prev);
    setSaving(false);
  }

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!quote) return <div className="p-6 text-sm text-red-600">Quotation not found</div>;

  const isExpired = quote.valid_until && new Date(quote.valid_until) < new Date();

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Sales" }, { label: "Quotations", href: "/sales/quotations" }, { label: quote.code ?? quote.id.slice(0, 8) }]} />

      {/* Header */}
      <div className="rounded-lg border border-line bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold font-mono">{quote.code ?? quote.id.slice(0, 8)}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[quote.status]}`}>{quote.status}</span>
            {isExpired && quote.status !== "accepted" && quote.status !== "rejected" && (
              <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-600">Expired</span>
            )}
          </div>
          {quote.title && <p className="text-sm font-medium mb-1">{quote.title}</p>}
          <div className="text-sm text-ink-3 space-y-0.5">
            {customer && <div className="font-medium text-foreground">{customer.name} <span className="text-xs text-ink-3">({customer.code})</span></div>}
            {!customer && quote.customer_name && <div className="font-medium text-foreground">{quote.customer_name}</div>}
            {quote.valid_until && <div className={isExpired ? "text-red-600" : ""}>Valid until: {quote.valid_until.slice(0, 10)}</div>}
            {quote.notes && <div className="text-xs mt-1">{quote.notes}</div>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          {quote.status === "draft" && (
            <button onClick={() => changeStatus("sent")} disabled={saving} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">Send</button>
          )}
          {quote.status === "sent" && (
            <>
              <button onClick={() => changeStatus("accepted")} disabled={saving} className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">Accept</button>
              <button onClick={() => changeStatus("rejected")} disabled={saving} className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">Reject</button>
            </>
          )}
          <button onClick={() => router.back()} className="px-3 py-1.5 text-xs rounded border border-line text-ink-3 hover:text-ink">← Back</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Total Amount</div>
          <div className="text-2xl font-mono font-bold text-green-600">{quote.total_amount != null ? fmt(quote.total_amount) : "—"}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Status</div>
          <div className="text-2xl font-mono font-bold capitalize">{quote.status}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Valid Until</div>
          <div className={`text-2xl font-mono font-bold ${isExpired ? "text-red-600" : ""}`}>{quote.valid_until?.slice(0, 10) ?? "—"}</div>
        </div>
      </div>

      {/* Details grid */}
      <div className="rounded-lg border border-line bg-surface p-5 grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-ink-3">Quote #:</span> <span className="font-mono">{quote.code ?? "—"}</span></div>
        <div><span className="text-ink-3">Customer:</span> {customer?.name ?? quote.customer_name ?? "—"}</div>
        <div><span className="text-ink-3">Valid Until:</span> <span className={isExpired ? "text-red-600 font-medium" : ""}>{quote.valid_until?.slice(0, 10) ?? "—"}</span></div>
        <div><span className="text-ink-3">Status:</span> {quote.status}</div>
        {quote.total_amount != null && <div><span className="text-ink-3">Total Amount:</span> <span className="font-mono font-semibold">{fmt(quote.total_amount)}</span></div>}
        {quote.notes && <div className="col-span-2"><span className="text-ink-3">Notes:</span> {quote.notes}</div>}
      </div>
    </div>
  );
}
