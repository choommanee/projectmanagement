"use client";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listShipments,
  createShipment,
  updateShipmentStatus,
  listSalesOrders,
  type Shipment,
  type ShipmentStatus,
  type SalesOrder,
} from "@/lib/api/sales";

// ── status config ──────────────────────────────────────────────────────────

const STATUS_TABS: { value: ShipmentStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "packed", label: "Packed" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "returned", label: "Returned" },
];

const STATUS_BADGE: Record<ShipmentStatus, { bg: string; text: string; border: string }> = {
  pending:   { bg: "bg-zinc-800",   text: "text-zinc-300",   border: "border-zinc-600" },
  packed:    { bg: "bg-blue-950",   text: "text-blue-300",   border: "border-blue-700" },
  shipped:   { bg: "bg-amber-950",  text: "text-amber-300",  border: "border-amber-700" },
  delivered: { bg: "bg-emerald-950",text: "text-emerald-300",border: "border-emerald-800" },
  returned:  { bg: "bg-red-950",    text: "text-red-300",    border: "border-red-700" },
};

const NEXT_STATUS: Partial<Record<ShipmentStatus, ShipmentStatus>> = {
  pending:  "packed",
  packed:   "shipped",
  shipped:  "delivered",
};

const ACTION_LABEL: Partial<Record<ShipmentStatus, string>> = {
  pending: "Pack",
  packed:  "Ship",
  shipped: "Deliver",
};

// ── new shipment dialog ─────────────────────────────────────────────────────

function NewShipmentDialog({
  open,
  salesOrders,
  onClose,
  onCreated,
}: {
  open: boolean;
  salesOrders: SalesOrder[];
  onClose: () => void;
  onCreated: (s: Shipment) => void;
}) {
  const [soId, setSoId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setSoId(""); setNotes(""); setError(null); }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!soId) { setError("Select a sales order."); return; }
    setLoading(true);
    setError(null);
    try {
      const s = await createShipment({ so_id: soId, notes: notes || undefined });
      onCreated(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shipment");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-zinc-100 mb-4">New Shipment</h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1 uppercase tracking-wide">Sales Order</label>
            <select
              value={soId}
              onChange={(e) => setSoId(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-400"
            >
              <option value="">-- Select SO --</option>
              {salesOrders.map((so) => (
                <option key={so.id} value={so.id}>
                  {so.soNumber} {so.customerId ? `· ${so.customerId}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-400 mb-1 uppercase tracking-wide">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-400 resize-none"
              placeholder="Optional notes..."
            />
          </div>
          {error && (
            <p className="text-xs text-red-400 border border-red-800 bg-red-950 rounded px-3 py-2">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm rounded border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-1.5 text-sm rounded bg-zinc-700 text-zinc-100 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
            >
              {loading ? "Creating..." : "Create Shipment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── main page ───────────────────────────────────────────────────────────────

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [activeTab, setActiveTab] = useState<ShipmentStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  function fetchShipments() {
    setLoading(true);
    setError(null);
    listShipments({ status: activeTab || undefined, limit: 100 })
      .then((r) => setShipments(r.items))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load shipments"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchShipments();
    // Also load sales orders for the dialog
    listSalesOrders({ limit: 100 })
      .then((r) => setSalesOrders(r.items))
      .catch(() => {/* non-critical */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  async function handleAction(shipment: Shipment) {
    const next = NEXT_STATUS[shipment.status];
    if (!next) return;
    setActionLoading(shipment.id);
    try {
      await updateShipmentStatus(shipment.id, next);
      fetchShipments();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status update failed");
    } finally {
      setActionLoading(null);
    }
  }

  function handleCreated(s: Shipment) {
    setDialogOpen(false);
    setShipments((prev) => [s, ...prev]);
  }

  return (
    <div className="p-6 space-y-4">
      <Breadcrumb items={[{ label: "Sales" }, { label: "Shipments" }]} />

      {/* header row */}
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-zinc-100">Shipments</h1>
        <button
          onClick={() => setDialogOpen(true)}
          className="px-3 py-1.5 text-sm rounded bg-zinc-700 text-zinc-100 hover:bg-zinc-600 transition-colors border border-zinc-600"
        >
          + New Shipment
        </button>
      </div>

      {/* status filter tabs */}
      <div className="flex gap-1 border-b border-zinc-700">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2 text-xs font-medium uppercase tracking-wide transition-colors border-b-2 -mb-px ${
              activeTab === tab.value
                ? "border-zinc-300 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="border border-red-700 bg-red-950 text-red-300 rounded px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-zinc-400 text-sm py-12 text-center">Loading shipments...</div>
      ) : shipments.length === 0 ? (
        <div className="text-zinc-500 text-sm py-12 text-center">
          No shipments found{activeTab ? ` with status "${activeTab}"` : ""}.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-zinc-700">
            <thead>
              <tr className="bg-zinc-800 text-zinc-300 uppercase text-xs tracking-wider">
                <th className="border border-zinc-700 px-4 py-2 text-left">Shipment #</th>
                <th className="border border-zinc-700 px-4 py-2 text-left">SO #</th>
                <th className="border border-zinc-700 px-4 py-2 text-left">Customer</th>
                <th className="border border-zinc-700 px-4 py-2 text-center">Status</th>
                <th className="border border-zinc-700 px-4 py-2 text-left">Created</th>
                <th className="border border-zinc-700 px-4 py-2 text-center w-28">Action</th>
              </tr>
            </thead>
            <tbody>
              {shipments.map((s) => {
                const badge = STATUS_BADGE[s.status];
                const nextStatus = NEXT_STATUS[s.status];
                const actionLabel = ACTION_LABEL[s.status];
                const isActing = actionLoading === s.id;
                const createdDate = s.createdAt
                  ? new Date(s.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                  : "—";

                return (
                  <tr key={s.id} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="border border-zinc-700 px-4 py-2 font-mono text-zinc-100">
                      {s.shipmentNumber || s.id.slice(0, 8)}
                    </td>
                    <td className="border border-zinc-700 px-4 py-2 font-mono text-zinc-300">
                      {s.soNumber || s.soId.slice(0, 8)}
                    </td>
                    <td className="border border-zinc-700 px-4 py-2 text-zinc-300">
                      {s.customerName || s.customerId || "—"}
                    </td>
                    <td className="border border-zinc-700 px-4 py-2 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded border text-xs font-medium uppercase tracking-wide ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="border border-zinc-700 px-4 py-2 text-zinc-400 font-mono text-xs">
                      {createdDate}
                    </td>
                    <td className="border border-zinc-700 px-4 py-2 text-center">
                      {nextStatus && actionLabel ? (
                        <button
                          onClick={() => handleAction(s)}
                          disabled={isActing}
                          className="px-3 py-1 text-xs rounded border border-zinc-600 text-zinc-300 hover:text-zinc-100 hover:border-zinc-400 disabled:opacity-50 transition-colors"
                        >
                          {isActing ? "..." : actionLabel}
                        </button>
                      ) : (
                        <span className="text-zinc-600 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NewShipmentDialog
        open={dialogOpen}
        salesOrders={salesOrders}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
