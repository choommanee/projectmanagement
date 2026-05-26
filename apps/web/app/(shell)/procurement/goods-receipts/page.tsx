"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listPurchaseOrders, getPurchaseOrder, receivePO,
  type PurchaseOrder, type POLine,
} from "@/lib/api/mfg";

function ReceivePODialog({
  po, open, onClose, onDone,
}: { po: PurchaseOrder | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [lines, setLines] = useState<Array<{ line_id: string; qty_ordered: number; qty_received: number; item_id: string }>>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && po) {
      getPurchaseOrder(po.id).then((fullPO) => {
        setLines((fullPO.lines ?? []).map((l: POLine) => ({
          line_id: l.id,
          qty_ordered: l.qtyOrdered,
          qty_received: l.qtyOrdered,
          item_id: l.itemId,
        })));
      }).catch(() => setError("Failed to load PO lines."));
      setNotes("");
      setError(null);
    }
  }, [open, po]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!po) return;
    setLoading(true);
    try {
      await receivePO(po.id, {
        lines: lines.map((l) => ({ line_id: l.line_id, qty_received: l.qty_received })),
        notes: notes || undefined,
      });
      onDone();
    } catch (err) {
      setError(String(err));
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Receive PO — ${po?.poNumber ?? po?.id?.slice(0, 8)}`}>
      <form onSubmit={submit} className="flex flex-col gap-4 p-4 min-w-[400px]">
        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Lines to Receive</p>
          {lines.map((l, i) => (
            <div key={l.line_id} className="flex items-center gap-3 rounded border border-line bg-surface-2 px-3 py-2">
              <span className="flex-1 text-sm font-mono text-xs">{l.item_id}</span>
              <span className="text-xs text-ink-muted">Ordered: {l.qty_ordered}</span>
              <input
                type="number"
                min={0}
                max={l.qty_ordered}
                value={l.qty_received}
                onChange={(e) => setLines((prev) => prev.map((r, j) => j === i ? { ...r, qty_received: Number(e.target.value) } : r))}
                className="w-20 rounded border border-line bg-surface px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          ))}
          {lines.length === 0 && !error && (
            <p className="text-sm text-ink-muted">Loading lines…</p>
          )}
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            placeholder="Delivery note, batch reference…"
          />
        </label>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading || lines.length === 0}>
            {loading ? "Receiving…" : "Confirm Receipt"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function GoodsReceiptsPage() {
  const [pos, setPOs] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [receivingPO, setReceivingPO] = useState<PurchaseOrder | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listPurchaseOrders({ status: "approved" })
      .then((result) => setPOs(result.items))
      .catch(() => setPOs([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function openReceive(po: PurchaseOrder) {
    setReceivingPO(po);
    setDialogOpen(true);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Procurement", href: "/procurement/home" }, { label: "Goods Receipts" }]} />
      <CommandBar actions={[]} />

      <div className="rounded border border-line bg-surface-2 px-4 py-2 text-sm text-ink-muted">
        Showing approved Purchase Orders ready for goods receipt.
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">PO Number</th>
                <th className="px-4 py-2 text-left font-medium">Supplier</th>
                <th className="px-4 py-2 text-left font-medium">Order Date</th>
                <th className="px-4 py-2 text-left font-medium">Expected</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {pos.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-muted">No approved POs awaiting receipt.</td></tr>
              ) : pos.map((po) => (
                <tr key={po.id} className="hover:bg-surface-2/50">
                  <td className="px-4 py-2 font-mono text-xs">{po.poNumber ?? po.id.slice(0, 8)}</td>
                  <td className="px-4 py-2 font-medium">{po.supplierId}</td>
                  <td className="px-4 py-2 text-ink-muted">{po.orderDate ? new Date(po.orderDate).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2 text-ink-muted">{po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-2"><Tag tone="accent" size="sm">{po.status}</Tag></td>
                  <td className="px-4 py-2">
                    <Button size="sm" variant="primary" onClick={() => openReceive(po)}>Receive</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReceivePODialog
        po={receivingPO}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onDone={() => { setDialogOpen(false); load(); }}
      />
    </div>
  );
}
