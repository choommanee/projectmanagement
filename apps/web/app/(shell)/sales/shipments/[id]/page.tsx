"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getShipment, updateShipmentStatus, type Shipment, type ShipmentStatus } from "@/lib/api/sales";

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ship, setShip] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getShipment(id)
      .then(setShip)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleStatus(status: ShipmentStatus) {
    if (!ship) return;
    setSaving(true);
    try {
      await updateShipmentStatus(ship.id, status);
      setShip(prev => prev ? { ...prev, status } : prev);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!ship) return <div className="p-8 text-destructive">Shipment not found.</div>;

  const statusColors: Record<ShipmentStatus, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    packed: "bg-blue-100 text-blue-800",
    shipped: "bg-purple-100 text-purple-800",
    delivered: "bg-green-100 text-green-800",
    returned: "bg-red-100 text-red-800",
  };

  const transitions: { from: ShipmentStatus[]; to: ShipmentStatus; label: string; color: string }[] = [
    { from: ["pending"], to: "packed", label: "Mark Packed", color: "bg-blue-600 text-white hover:bg-blue-700" },
    { from: ["packed"], to: "shipped", label: "Mark Shipped", color: "bg-purple-600 text-white hover:bg-purple-700" },
    { from: ["shipped"], to: "delivered", label: "Mark Delivered", color: "bg-green-600 text-white hover:bg-green-700" },
    { from: ["shipped", "delivered"], to: "returned", label: "Return", color: "border border-line hover:bg-surface-2" },
  ];

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/sales/shipments")} className="hover:underline">Shipments</button>
        <span className="mx-2">/</span>
        <span>{ship.shipmentNumber}</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{ship.shipmentNumber}</h1>
            <p className="text-sm text-ink-3 mt-1">{ship.customerName ?? "Customer"} · SO: {ship.soNumber ?? ship.soId}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusColors[ship.status]}`}>
            {ship.status}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {transitions
            .filter(t => t.from.includes(ship.status))
            .map(t => (
              <button key={t.to} onClick={() => handleStatus(t.to)} disabled={saving}
                className={`px-4 py-1.5 text-sm rounded disabled:opacity-50 ${t.color}`}>
                {t.label}
              </button>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: "Shipment #", value: ship.shipmentNumber },
          { label: "Sales Order", value: ship.soNumber ?? ship.soId },
          { label: "Customer", value: ship.customerName ?? "—" },
          { label: "Status", value: ship.status },
          { label: "Created", value: ship.createdAt ? ship.createdAt.slice(0, 10) : "—" },
          { label: "Notes", value: ship.notes || "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-line bg-card p-4">
            <p className="text-xs text-ink-3 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-medium">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
