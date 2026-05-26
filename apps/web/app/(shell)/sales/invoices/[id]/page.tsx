"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSalesInvoice, updateInvoiceStatus, getCustomer, type SalesInvoice, type InvoiceStatus } from "@/lib/api/sales";
import type { Customer } from "@/lib/api/sales";

export default function SalesInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inv, setInv] = useState<SalesInvoice | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getSalesInvoice(id)
      .then(data => {
        setInv(data);
        if (data.customer_id) getCustomer(data.customer_id).then(setCustomer).catch(() => {});
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleStatus(status: InvoiceStatus) {
    if (!inv) return;
    setSaving(true);
    try {
      await updateInvoiceStatus(inv.id, status);
      setInv(prev => prev ? { ...prev, status } : prev);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!inv) return <div className="p-8 text-destructive">Invoice not found.</div>;

  const isOverdue = inv.due_date && inv.status !== "paid" && inv.status !== "cancelled" && new Date(inv.due_date) < new Date();
  const statusColors: Record<InvoiceStatus, string> = {
    draft: "bg-muted text-muted-foreground",
    sent: "bg-blue-100 text-blue-800",
    paid: "bg-green-100 text-green-800",
    overdue: "bg-red-100 text-red-800",
    cancelled: "bg-gray-200 text-gray-500",
  };

  return (
    <div className="p-6 space-y-6">
      {/* Breadcrumb */}
      <nav className="text-sm text-muted-foreground">
        <button onClick={() => router.push("/sales/invoices")} className="hover:underline">Invoices</button>
        <span className="mx-2">/</span>
        <span>{inv.code ?? inv.id}</span>
      </nav>

      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{inv.code ?? "Invoice"}</h1>
            <p className="text-sm text-muted-foreground mt-1">{customer?.name ?? inv.customer_id}</p>
            {isOverdue && (
              <p className="mt-2 text-sm font-medium text-destructive">⚠ Overdue since {inv.due_date}</p>
            )}
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusColors[inv.status]}`}>
            {inv.status}
          </span>
        </div>
        {/* Action buttons */}
        <div className="mt-4 flex flex-wrap gap-2">
          {inv.status === "draft" && (
            <button onClick={() => handleStatus("sent")} disabled={saving}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              Send Invoice
            </button>
          )}
          {inv.status === "sent" && (
            <button onClick={() => handleStatus("paid")} disabled={saving}
              className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
              Mark Paid
            </button>
          )}
          {(inv.status === "draft" || inv.status === "sent") && (
            <button onClick={() => handleStatus("cancelled")} disabled={saving}
              className="px-4 py-1.5 text-sm border border-border rounded hover:bg-muted disabled:opacity-50">
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Subtotal", value: inv.subtotal != null ? `$${inv.subtotal.toFixed(2)}` : "—" },
          { label: "Tax", value: inv.tax != null ? `$${inv.tax.toFixed(2)}` : "—" },
          { label: "Total", value: inv.total != null ? `$${inv.total.toFixed(2)}` : "—" },
          { label: "Due Date", value: inv.due_date ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-lg font-semibold font-mono">{value}</p>
          </div>
        ))}
      </div>

      {/* Details grid */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 text-sm">
          <div><dt className="text-muted-foreground">Invoice #</dt><dd className="font-medium">{inv.code ?? inv.id}</dd></div>
          <div><dt className="text-muted-foreground">Customer</dt><dd className="font-medium">{customer?.name ?? inv.customer_id}</dd></div>
          <div><dt className="text-muted-foreground">Issue Date</dt><dd className="font-medium">{inv.issue_date}</dd></div>
          <div><dt className="text-muted-foreground">Due Date</dt><dd className="font-medium">{inv.due_date ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">SO Reference</dt><dd className="font-medium">{inv.so_id ?? "—"}</dd></div>
          <div><dt className="text-muted-foreground">Notes</dt><dd className="font-medium">{inv.notes ?? "—"}</dd></div>
        </dl>
      </div>
    </div>
  );
}
