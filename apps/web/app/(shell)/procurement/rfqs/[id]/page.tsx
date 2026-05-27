"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { getRFQ, sendRFQ, type RFQ, type RFQStatus } from "@/lib/api/mfg";

const STATUS_COLORS: Record<RFQStatus, string> = {
  draft: "bg-surface-2 text-ink-3",
  sent: "bg-blue-100 text-blue-700",
  received: "bg-green-100 text-green-700",
  closed: "bg-zinc-200 text-zinc-500",
};

export default function RFQDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [rfq, setRfq] = useState<RFQ | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!id) return;
    getRFQ(id).then(setRfq).finally(() => setLoading(false));
  }, [id]);

  async function handleSend() {
    if (!rfq) return;
    setSending(true);
    const updated = await sendRFQ(rfq.id).catch(() => null);
    if (updated) setRfq(updated);
    setSending(false);
  }

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });
  const totalQuoted = rfq?.lines.reduce((s, l) => s + (l.quotedPrice ?? 0) * l.qtyRequested, 0) ?? 0;
  const hasQuotes = rfq?.lines.some(l => l.quotedPrice != null);

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!rfq) return <div className="p-6 text-sm text-red-600">RFQ not found</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Procurement" }, { label: "RFQs", href: "/procurement/rfqs" }, { label: rfq.rfqNumber }]} />

      {/* Header */}
      <div className="rounded-lg border border-line bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold font-mono">{rfq.rfqNumber}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[rfq.status]}`}>{rfq.status}</span>
          </div>
          <div className="text-sm text-ink-3 space-y-0.5">
            <div className="font-medium text-foreground">{rfq.supplierName}</div>
            {rfq.sentAt && <div>Sent: {rfq.sentAt.slice(0, 10)}</div>}
            {rfq.responseDeadline && <div>Deadline: {rfq.responseDeadline.slice(0, 10)}</div>}
            {rfq.notes && <div className="text-xs mt-1">{rfq.notes}</div>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {rfq.status === "draft" && (
            <button onClick={handleSend} disabled={sending} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              Send to Supplier
            </button>
          )}
          <button onClick={() => router.back()} className="px-3 py-1.5 text-xs rounded border border-line text-ink-3 hover:text-ink">← Back</button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Lines</div>
          <div className="text-2xl font-mono font-bold">{rfq.lines.length}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Quoted Value</div>
          <div className={`text-2xl font-mono font-bold ${hasQuotes ? "text-green-600" : "text-ink-3"}`}>{hasQuotes ? fmt(totalQuoted) : "—"}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Lines with Quote</div>
          <div className="text-2xl font-mono font-bold">{rfq.lines.filter(l => l.quotedPrice != null).length}/{rfq.lines.length}</div>
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-lg border border-line overflow-hidden">
        <div className="px-4 py-3 bg-surface-2 text-sm font-medium">RFQ Lines</div>
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-3 uppercase bg-surface-2">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Item</th>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-right font-medium">Qty Requested</th>
              <th className="px-4 py-2 text-right font-medium">Quoted Price</th>
              <th className="px-4 py-2 text-right font-medium">Lead Days</th>
              <th className="px-4 py-2 text-right font-medium">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {rfq.lines.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-3">No lines</td></tr>}
            {rfq.lines.map(l => (
              <tr key={l.id} className="border-t border-line hover:bg-surface-2">
                <td className="px-4 py-3 font-mono text-xs">{l.itemCode}</td>
                <td className="px-4 py-3 text-xs">{l.itemName}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{l.qtyRequested}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{l.quotedPrice != null ? fmt(l.quotedPrice) : <span className="text-ink-3">—</span>}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{l.quotedLeadDays != null ? `${l.quotedLeadDays}d` : <span className="text-ink-3">—</span>}</td>
                <td className="px-4 py-3 text-right font-mono text-xs font-semibold">{l.quotedPrice != null ? fmt(l.quotedPrice * l.qtyRequested) : <span className="text-ink-3">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
