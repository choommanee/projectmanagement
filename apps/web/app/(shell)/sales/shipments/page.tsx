"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listShipments,
  createShipment,
  updateShipment,
  deleteShipment,
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

function statusTone(s: ShipmentStatus): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "pending") return "neutral";
  if (s === "packed") return "info";
  if (s === "shipped") return "accent";
  if (s === "delivered") return "success";
  if (s === "returned") return "warning";
  return "neutral";
}

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

  return (
    <Dialog open={open} onClose={onClose} title="New Shipment">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[360px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Sales Order *</span>
          <select
            value={soId}
            onChange={(e) => setSoId(e.target.value)}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">— select SO —</option>
            {salesOrders.map((so) => (
              <option key={so.id} value={so.id}>
                {so.soNumber} {so.customerId ? `· ${so.customerId}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Notes</span>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes…"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create Shipment"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── edit shipment dialog ────────────────────────────────────────────────────

function EditShipmentDialog({
  shipment,
  onClose,
  onSaved,
}: {
  shipment: Shipment | null;
  onClose: () => void;
  onSaved: (s: Shipment) => void;
}) {
  const [form, setForm] = useState({ status: "pending" as ShipmentStatus, tracking_no: "", carrier: "", ship_date: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (shipment) {
      setForm({
        status: shipment.status,
        tracking_no: "",
        carrier: "",
        ship_date: "",
        notes: shipment.notes ?? "",
      });
      setError(null);
    }
  }, [shipment]);

  if (!shipment) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!shipment) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await updateShipment(shipment.id, {
        status: form.status,
        tracking_no: form.tracking_no || undefined,
        carrier: form.carrier || undefined,
        ship_date: form.ship_date || undefined,
        notes: form.notes || undefined,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!shipment} onClose={onClose} title="Edit Shipment">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[360px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            value={form.status}
            onChange={(e) => setForm(f => ({ ...f, status: e.target.value as ShipmentStatus }))}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {STATUS_TABS.filter(t => t.value).map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Tracking Number</span>
          <Input value={form.tracking_no} onChange={(e) => setForm(f => ({ ...f, tracking_no: e.target.value }))} placeholder="e.g. TH123456789" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Carrier</span>
          <Input value={form.carrier} onChange={(e) => setForm(f => ({ ...f, carrier: e.target.value }))} placeholder="e.g. DHL, FedEx" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Ship Date</span>
          <Input type="date" value={form.ship_date} onChange={(e) => setForm(f => ({ ...f, ship_date: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Notes</span>
          <Input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── main page ───────────────────────────────────────────────────────────────

export default function ShipmentsPage() {
  const router = useRouter();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [activeTab, setActiveTab] = useState<ShipmentStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editShipment, setEditShipment] = useState<Shipment | null>(null);
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

  async function handleDelete(shipment: Shipment) {
    if (!confirm(`Delete shipment ${shipment.shipmentNumber || shipment.id.slice(0, 8)}? It will be marked as returned.`)) return;
    setActionLoading(shipment.id);
    try {
      await deleteShipment(shipment.id);
      setShipments((prev) => prev.filter((s) => s.id !== shipment.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setActionLoading(null);
    }
  }

  function handleCreated(s: Shipment) {
    setDialogOpen(false);
    setShipments((prev) => [s, ...prev]);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Sales", href: "/sales/home" }, { label: "Shipments" }]} />

      {/* header row */}
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-ink">Shipments</h1>
        <Button variant="primary" size="sm" onClick={() => setDialogOpen(true)}>
          + New Shipment
        </Button>
      </div>

      {/* status filter tabs */}
      <div className="flex gap-1 border-b border-line">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-4 py-2 text-xs font-medium uppercase tracking-wide transition-colors border-b-2 -mb-px ${
              activeTab === tab.value
                ? "border-accent text-accent"
                : "border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-ink-3">Loading shipments…</p>
      ) : shipments.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-3">
          No shipments found{activeTab ? ` with status "${activeTab}"` : ""}.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Shipment #</th>
                <th className="px-4 py-2 text-left font-medium">SO #</th>
                <th className="px-4 py-2 text-left font-medium">Customer</th>
                <th className="px-4 py-2 text-center font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Created</th>
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {shipments.map((s) => {
                const nextStatus = NEXT_STATUS[s.status];
                const actionLabel = ACTION_LABEL[s.status];
                const isActing = actionLoading === s.id;
                const createdDate = s.createdAt
                  ? new Date(s.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                  : "—";

                return (
                  <tr
                    key={s.id}
                    className="hover:bg-surface-2/50 cursor-pointer transition-colors"
                    onClick={() => router.push('/sales/shipments/' + s.id)}
                  >
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-ink">
                      {s.shipmentNumber || s.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-2">
                      {s.soNumber || s.soId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2 text-ink-2">
                      {s.customerName || s.customerId || "—"}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <Tag tone={statusTone(s.status)} size="sm">{s.status}</Tag>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-3">
                      {createdDate}
                    </td>
                    <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1">
                        {nextStatus && actionLabel && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleAction(s)}
                            disabled={isActing}
                          >
                            {isActing ? "…" : actionLabel}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditShipment(s)}
                          disabled={isActing}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDelete(s)}
                          disabled={isActing}
                        >
                          <span className="text-danger">Del</span>
                        </Button>
                      </div>
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

      <EditShipmentDialog
        shipment={editShipment}
        onClose={() => setEditShipment(null)}
        onSaved={(updated) => {
          setShipments((prev) => prev.map((s) => s.id === updated.id ? updated : s));
          setEditShipment(null);
        }}
      />
    </div>
  );
}
