"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listRFQs, createRFQ, sendRFQ, listSuppliers,
  type RFQ, type RFQStatus, type Supplier,
} from "@/lib/api/mfg";

const STATUS_LABELS: Record<RFQStatus, string> = {
  draft: "Draft", sent: "Sent", received: "Received", closed: "Closed",
};

const STATUS_COLORS: Record<RFQStatus, string> = {
  draft: "bg-surface-2 text-ink-3",
  sent: "bg-blue-100 text-blue-700",
  received: "bg-green-100 text-green-700",
  closed: "bg-zinc-200 text-zinc-500",
};

export default function RFQPage() {
  const router = useRouter();
  const [rfqs, setRfqs] = useState<RFQ[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filter, setFilter] = useState<RFQStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newSupplierId, setNewSupplierId] = useState("");
  const [newDeadline, setNewDeadline] = useState("");
  const [selected, setSelected] = useState<RFQ | null>(null);

  useEffect(() => {
    Promise.all([
      listRFQs({ limit: 100 }).then(r => setRfqs(r.items)),
      listSuppliers().then(setSuppliers),
    ]).finally(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? rfqs : rfqs.filter(r => r.status === filter);

  async function handleCreate() {
    if (!newSupplierId) return;
    const rfq = await createRFQ({ supplier_id: newSupplierId, response_deadline: newDeadline || undefined });
    setRfqs(prev => [rfq, ...prev]);
    setShowNew(false);
    setNewSupplierId("");
    setNewDeadline("");
  }

  async function handleSend(rfq: RFQ) {
    const updated = await sendRFQ(rfq.id);
    setRfqs(prev => prev.map(r => r.id === updated.id ? updated : r));
    if (selected?.id === updated.id) setSelected(updated);
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Procurement" }, { label: "RFQ" }]} />

      <div className="grid grid-cols-4 gap-4">
        {(["draft", "sent", "received", "closed"] as RFQStatus[]).map(s => (
          <div key={s} className="rounded-lg border border-line bg-surface p-4">
            <div className="text-xs text-ink-3 mb-1">{STATUS_LABELS[s]}</div>
            <div className="text-2xl font-mono font-semibold">{rfqs.filter(r => r.status === s).length}</div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1">
          {(["all", "draft", "sent", "received", "closed"] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${filter === s ? "bg-accent text-white border-accent" : "border-line text-ink-3 hover:bg-surface-2"}`}>
              {s === "all" ? "All" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)} className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/90">
          + New RFQ
        </button>
      </div>

      {showNew && (
        <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
          <h3 className="text-sm font-medium">Create RFQ</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-ink-3 block mb-1">Supplier</label>
              <select value={newSupplierId} onChange={e => setNewSupplierId(e.target.value)}
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface">
                <option value="">Select supplier…</option>
                {suppliers.filter(s => s.active).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-ink-3 block mb-1">Response Deadline</label>
              <input type="date" value={newDeadline} onChange={e => setNewDeadline(e.target.value)}
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90">Create</button>
            <button onClick={() => setShowNew(false)} className="px-3 py-1.5 text-xs rounded border border-line hover:bg-surface-2">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink-3">Loading…</div>
      ) : (
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">RFQ #</th>
                <th className="px-4 py-2 text-left font-medium">Supplier</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Lines</th>
                <th className="px-4 py-2 text-left font-medium">Deadline</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-3">No RFQs found</td></tr>
              )}
              {filtered.map(rfq => (
                <tr key={rfq.id} className="border-t border-line hover:bg-surface-2 cursor-pointer" onClick={() => router.push('/procurement/rfqs/' + rfq.id)}>
                  <td className="px-4 py-3 font-mono text-xs">{rfq.rfqNumber}</td>
                  <td className="px-4 py-3">{rfq.supplierName}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[rfq.status]}`}>
                      {STATUS_LABELS[rfq.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-3">{rfq.lines.length}</td>
                  <td className="px-4 py-3 text-ink-3 text-xs">
                    {rfq.responseDeadline ? new Date(rfq.responseDeadline).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {rfq.status === "draft" && (
                      <button onClick={e => { e.stopPropagation(); handleSend(rfq); }}
                        className="px-2 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700">
                        Send to Supplier
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="fixed inset-y-0 right-0 w-96 bg-surface border-l border-line shadow-xl p-6 overflow-y-auto z-50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-sm">{selected.rfqNumber}</h2>
            <button onClick={() => setSelected(null)} className="text-ink-3 hover:text-ink text-lg">×</button>
          </div>
          <div className="space-y-3 text-sm">
            <div><span className="text-ink-3">Supplier:</span> {selected.supplierName}</div>
            <div><span className="text-ink-3">Status:</span>{" "}
              <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[selected.status]}`}>{STATUS_LABELS[selected.status]}</span>
            </div>
            {selected.responseDeadline && (
              <div><span className="text-ink-3">Deadline:</span> {new Date(selected.responseDeadline).toLocaleDateString()}</div>
            )}
            {selected.notes && <div><span className="text-ink-3">Notes:</span> {selected.notes}</div>}
            {selected.lines.length > 0 && (
              <div>
                <div className="text-ink-3 mb-2">Lines</div>
                <div className="space-y-1">
                  {selected.lines.map(l => (
                    <div key={l.id} className="border border-line rounded p-2 text-xs">
                      <div className="font-medium">{l.itemCode} — {l.itemName}</div>
                      <div className="text-ink-3 mt-0.5">
                        Qty: {l.qtyRequested}
                        {l.quotedPrice != null && ` · Price: ${l.quotedPrice.toLocaleString()}`}
                        {l.quotedLeadDays != null && ` · Lead: ${l.quotedLeadDays}d`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
