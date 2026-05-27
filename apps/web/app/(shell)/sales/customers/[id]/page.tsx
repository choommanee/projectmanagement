"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getCustomer, listSalesOrders, listQuotes, listSalesInvoices, listShipments,
  type Customer, type SalesOrder, type Quote, type SalesInvoice, type Shipment,
  type SOStatus, type QuoteStatus, type InvoiceStatus,
} from "@/lib/api/sales";

const SO_COLORS: Record<SOStatus, string> = {
  draft: "bg-surface-2 text-ink-3",
  confirmed: "bg-blue-100 text-blue-700",
  shipped: "bg-amber-100 text-amber-700",
  invoiced: "bg-indigo-100 text-indigo-700",
  cancelled: "bg-red-100 text-red-600",
};

const QUOTE_COLORS: Record<QuoteStatus, string> = {
  draft: "bg-surface-2 text-ink-3",
  sent: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-600",
  expired: "bg-zinc-200 text-zinc-500",
};

const INV_COLORS: Record<InvoiceStatus, string> = {
  draft: "bg-surface-2 text-ink-3",
  sent: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-zinc-200 text-zinc-500",
};

type Tab = "orders" | "quotes" | "invoices" | "shipments";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [invoices, setInvoices] = useState<SalesInvoice[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [tab, setTab] = useState<Tab>("orders");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getCustomer(id).then(setCustomer),
      listSalesOrders({ limit: 100 }).then(r => setOrders(r.items.filter(o => o.customerId === id))),
      listQuotes({ customer_id: id }).then(setQuotes),
      listSalesInvoices().then(invs => setInvoices(invs.filter(inv => inv.customer_id === id))),
      listShipments({ limit: 100 }).then(r => setShipments(r.items)),
    ]).finally(() => setLoading(false));
  }, [id]);

  const totalRevenue = useMemo(() =>
    invoices.filter(i => i.status === "paid").reduce((s, i) => s + (i.total ?? 0), 0), [invoices]);
  const openOrders = orders.filter(o => o.status !== "cancelled" && o.status !== "invoiced").length;
  const pendingAR = invoices.filter(i => i.status === "sent" || i.status === "overdue").reduce((s, i) => s + (i.total ?? 0), 0);
  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!customer) return <div className="p-6 text-sm text-red-600">Customer not found</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Sales" }, { label: "Customers", href: "/sales/customers" }, { label: customer.name }]} />

      <div className="rounded-lg border border-line bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-ink-3">{customer.code}</span>
            {!customer.active && <span className="px-1.5 py-0.5 rounded text-xs bg-surface-2 text-ink-3">Inactive</span>}
          </div>
          <h1 className="text-xl font-semibold">{customer.name}</h1>
          <div className="mt-2 space-y-0.5 text-sm text-ink-3">
            {customer.contact && <div>{customer.contact}</div>}
            {customer.email && <div>{customer.email}</div>}
            {customer.phone && <div>{customer.phone}</div>}
            {customer.billingAddress && <div className="text-xs">{customer.billingAddress}</div>}
          </div>
        </div>
        <button onClick={() => router.back()} className="text-xs text-ink-3 hover:text-ink border border-line px-3 py-1.5 rounded">← Back</button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Total Revenue</div>
          <div className="text-xl font-mono font-bold text-green-600">{fmt(totalRevenue)}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Open Orders</div>
          <div className="text-xl font-mono font-bold">{openOrders}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Outstanding AR</div>
          <div className={`text-xl font-mono font-bold ${pendingAR > 0 ? "text-amber-600" : ""}`}>{fmt(pendingAR)}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Quotes</div>
          <div className="text-xl font-mono font-bold">{quotes.length}</div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-line">
        {(["orders", "quotes", "invoices", "shipments"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === t ? "border-accent text-accent" : "border-transparent text-ink-3 hover:text-ink"}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}{" "}
            <span className="text-xs">({t === "orders" ? orders.length : t === "quotes" ? quotes.length : t === "invoices" ? invoices.length : shipments.length})</span>
          </button>
        ))}
      </div>

      {tab === "orders" && (
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">SO #</th>
                <th className="px-4 py-2 text-left font-medium">Date</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Lines</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-3">No orders</td></tr>}
              {orders.map(o => (
                <tr key={o.id} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-3 font-mono text-xs">{o.soNumber}</td>
                  <td className="px-4 py-3 text-xs">{o.orderDate?.slice(0, 10)}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${SO_COLORS[o.status]}`}>{o.status}</span></td>
                  <td className="px-4 py-3 text-right text-xs">{o.lines.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "quotes" && (
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Quote #</th>
                <th className="px-4 py-2 text-left font-medium">Valid Until</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {quotes.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-3">No quotes</td></tr>}
              {quotes.map(q => (
                <tr key={q.id} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-3 font-mono text-xs">{q.code ?? q.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-xs">{q.valid_until?.slice(0, 10) ?? "—"}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${QUOTE_COLORS[q.status]}`}>{q.status}</span></td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(q.total_amount ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "invoices" && (
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Invoice</th>
                <th className="px-4 py-2 text-left font-medium">Issued</th>
                <th className="px-4 py-2 text-left font-medium">Due</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-3">No invoices</td></tr>}
              {invoices.map(inv => (
                <tr key={inv.id} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-3 font-mono text-xs">{inv.code ?? inv.id.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-xs">{inv.issue_date?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs">{inv.due_date?.slice(0, 10) ?? "—"}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${INV_COLORS[inv.status]}`}>{inv.status}</span></td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(inv.total ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "shipments" && (
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Shipment #</th>
                <th className="px-4 py-2 text-left font-medium">SO #</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {shipments.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-3">No shipments</td></tr>}
              {shipments.map(s => (
                <tr key={s.id} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-3 font-mono text-xs">{s.shipmentNumber}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.soId}</td>
                  <td className="px-4 py-3 text-xs capitalize">{s.status}</td>
                  <td className="px-4 py-3 text-xs text-ink-3">{s.createdAt?.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
