"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getGoodsReceipt, type GoodsReceipt } from "@/lib/api/mfg";

export default function GoodsReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [gr, setGr] = useState<GoodsReceipt | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getGoodsReceipt(id).then(setGr).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!gr) return <div className="p-8 text-destructive">Goods receipt not found.</div>;

  const totalOrdered = gr.lines.reduce((s, l) => s + l.qty_ordered, 0);
  const totalReceived = gr.lines.reduce((s, l) => s + l.qty_received, 0);
  const receiveRate = totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 100) : 0;

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/procurement/goods-receipts")} className="hover:underline">Goods Receipts</button>
        <span className="mx-2">/</span>
        <span>{gr.id.slice(0, 8)}…</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Goods Receipt</h1>
            <p className="text-sm text-ink-3 mt-1">
              PO: {gr.po_code ?? gr.po_id} · {gr.supplier_name ?? "Unknown Supplier"}
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${gr.status === "confirmed" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
            {gr.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "PO Reference", value: gr.po_code ?? gr.po_id },
          { label: "Supplier", value: gr.supplier_name ?? "—" },
          { label: "Received At", value: gr.received_at ? gr.received_at.slice(0, 10) : "—" },
          { label: "Receive Rate", value: `${receiveRate}%` },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-line bg-card p-4">
            <p className="text-xs text-ink-3 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-line bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3 mb-4">Lines ({gr.lines.length})</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-3 text-xs uppercase">
              <th className="py-2 pr-4">Item</th>
              <th className="py-2 pr-4 text-right">Qty Ordered</th>
              <th className="py-2 pr-4 text-right">Qty Received</th>
              <th className="py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            {gr.lines.map((line, i) => {
              const pct = line.qty_ordered > 0 ? Math.round((line.qty_received / line.qty_ordered) * 100) : 0;
              return (
                <tr key={i} className="border-t border-line">
                  <td className="py-2 pr-4">{line.item_name ?? line.item_id}</td>
                  <td className="py-2 pr-4 text-right font-mono">{line.qty_ordered}</td>
                  <td className="py-2 pr-4 text-right font-mono">{line.qty_received}</td>
                  <td className="py-2 text-right">
                    <span className={`text-xs font-semibold ${pct >= 100 ? "text-green-600" : pct > 0 ? "text-blue-600" : "text-ink-3"}`}>
                      {pct}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-semibold">
              <td className="py-2 pr-4">Total</td>
              <td className="py-2 pr-4 text-right font-mono">{totalOrdered}</td>
              <td className="py-2 pr-4 text-right font-mono">{totalReceived}</td>
              <td className="py-2 text-right text-xs">{receiveRate}%</td>
            </tr>
          </tfoot>
        </table>
        {gr.notes && <p className="mt-4 text-sm text-ink-3">Notes: {gr.notes}</p>}
      </div>
    </div>
  );
}
