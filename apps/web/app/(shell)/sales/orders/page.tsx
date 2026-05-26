"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listSalesOrders, createSalesOrder, updateSalesOrder, getSalesOrder,
  listCustomers, addSOLine,
  type SalesOrder, type SOLine, type SOStatus, type Customer,
} from "@/lib/api/sales";

const SO_STATUSES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "confirmed", label: "Confirmed" },
  { value: "shipped", label: "Shipped" },
  { value: "invoiced", label: "Invoiced" },
  { value: "cancelled", label: "Cancelled" },
];

function statusTone(s: string): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "draft") return "neutral";
  if (s === "confirmed") return "info";
  if (s === "shipped") return "accent";
  if (s === "invoiced") return "success";
  if (s === "cancelled") return "danger";
  return "neutral";
}

// ─── New SO Dialog ────────────────────────────────────────────────────────────

function NewSODialog({
  open, customers, onClose, onCreated,
}: {
  open: boolean;
  customers: Customer[];
  onClose: () => void;
  onCreated: (so: SalesOrder) => void;
}) {
  const [form, setForm] = useState({
    customer_id: "",
    order_date: new Date().toISOString().split("T")[0],
    requested_date: "",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ customer_id: customers[0]?.id ?? "", order_date: new Date().toISOString().split("T")[0], requested_date: "", notes: "" });
      setError(null);
    }
  }, [open, customers]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!form.customer_id) { setError("Customer is required."); return; }
    setLoading(true);
    setError(null);
    try {
      const so = await createSalesOrder({
        customer_id: form.customer_id,
        order_date: form.order_date || undefined,
        requested_date: form.requested_date || undefined,
        notes: form.notes,
      });
      onCreated(so);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create Sales Order");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New Sales Order"
      description="Create a draft sales order for a customer"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>Create SO</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Customer *</label>
          <select
            value={form.customer_id}
            onChange={(e) => setForm(f => ({ ...f, customer_id: e.target.value }))}
            className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
          >
            <option value="">— select customer —</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Order Date</label>
            <Input type="date" value={form.order_date} onChange={(e) => setForm(f => ({ ...f, order_date: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Requested Date</label>
            <Input type="date" value={form.requested_date} onChange={(e) => setForm(f => ({ ...f, requested_date: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Notes</label>
          <Input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
        </div>
      </form>
    </Dialog>
  );
}

// ─── Add Line Row ─────────────────────────────────────────────────────────────

function AddSOLineRow({ soId, onAdded }: { soId: string; onAdded: (line: SOLine) => void }) {
  const [form, setForm] = useState({ item_desc: "", qty_ordered: "1", unit_price: "0", notes: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!form.item_desc) { setError("Item description required"); return; }
    setLoading(true);
    setError(null);
    try {
      const line = await addSOLine(soId, {
        item_desc: form.item_desc,
        qty_ordered: Number(form.qty_ordered) || 1,
        unit_price: Number(form.unit_price) || 0,
        notes: form.notes,
      });
      onAdded(line);
      setForm({ item_desc: "", qty_ordered: "1", unit_price: "0", notes: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add line");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <tr className="border-b border-line bg-surface-2/50">
        <td className="px-3 py-1 text-xs text-ink-3">new</td>
        <td className="px-3 py-1">
          <input
            value={form.item_desc}
            onChange={(e) => setForm(f => ({ ...f, item_desc: e.target.value }))}
            placeholder="Item description"
            className="h-7 w-full rounded-xs border border-line bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none"
          />
        </td>
        <td className="px-3 py-1">
          <input
            type="number"
            min="0"
            step="0.001"
            value={form.qty_ordered}
            onChange={(e) => setForm(f => ({ ...f, qty_ordered: e.target.value }))}
            className="h-7 w-24 rounded-xs border border-line bg-surface px-2 text-right font-mono text-xs text-ink focus:border-accent focus:outline-none"
          />
        </td>
        <td className="px-3 py-1 text-xs text-ink-3">—</td>
        <td className="px-3 py-1">
          <input
            type="number"
            min="0"
            step="0.01"
            value={form.unit_price}
            onChange={(e) => setForm(f => ({ ...f, unit_price: e.target.value }))}
            className="h-7 w-28 rounded-xs border border-line bg-surface px-2 text-right font-mono text-xs text-ink focus:border-accent focus:outline-none"
          />
        </td>
        <td className="px-3 py-1">
          <input
            value={form.notes}
            onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
            placeholder="Notes"
            className="h-7 w-full rounded-xs border border-line bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none"
          />
        </td>
        <td className="px-3 py-1">
          <button
            onClick={() => void add()}
            disabled={loading}
            className="rounded-xs bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {loading ? "..." : "Add"}
          </button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="px-3 py-1 text-xs text-danger">{error}</td>
        </tr>
      )}
    </>
  );
}

// ─── SO Detail ─────────────────────────────────────────────────────────────────

function SODetail({
  so: initialSo, customerMap, onStatusChanged,
}: {
  so: SalesOrder;
  customerMap: Map<string, Customer>;
  onStatusChanged: (so: SalesOrder) => void;
}) {
  const [so, setSo] = useState(initialSo);
  const [addingLine, setAddingLine] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setSo(initialSo); }, [initialSo]);

  const customer = customerMap.get(so.customerId);

  const TRANSITIONS: Partial<Record<SOStatus, { label: string; next: SOStatus }>> = {
    draft: { label: "Confirm", next: "confirmed" },
    confirmed: { label: "Mark Shipped", next: "shipped" },
    shipped: { label: "Mark Invoiced", next: "invoiced" },
  };

  async function advance() {
    const t = TRANSITIONS[so.status as SOStatus];
    if (!t) return;
    setStatusLoading(true);
    setError(null);
    try {
      const updated = await updateSalesOrder(so.id, { status: t.next });
      setSo(updated);
      onStatusChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setStatusLoading(false);
    }
  }

  const total = so.lines.reduce((sum, l) => sum + l.qtyOrdered * l.unitPrice, 0);
  const transition = TRANSITIONS[so.status as SOStatus];

  return (
    <div className="flex flex-col gap-0 overflow-auto">
      {/* Header */}
      <div className="border-b border-line bg-surface-2 px-4 py-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-ink">{so.soNumber || so.id.slice(0, 8)}</span>
              <Tag tone={statusTone(so.status)}>{so.status}</Tag>
            </div>
            <div className="mt-1 text-xs text-ink-2">
              {customer ? `${customer.code} — ${customer.name}` : so.customerId}
            </div>
          </div>
          {transition && (
            <button
              onClick={() => void advance()}
              disabled={statusLoading}
              className="rounded-xs border border-accent px-3 py-1 text-xs font-medium text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              {transition.label}
            </button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-4 text-xs">
          <div>
            <span className="text-ink-3">Order Date</span>
            <div className="font-mono text-ink">{so.orderDate ? new Date(so.orderDate).toLocaleDateString() : "—"}</div>
          </div>
          <div>
            <span className="text-ink-3">Requested</span>
            <div className="font-mono text-ink">{so.requestedDate ? new Date(so.requestedDate).toLocaleDateString() : "—"}</div>
          </div>
          <div>
            <span className="text-ink-3">Total</span>
            <div className="font-mono font-semibold text-ink">{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
        </div>
        {so.notes && <p className="mt-2 text-xs text-ink-2">{so.notes}</p>}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>

      {/* Lines */}
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-between px-4 py-2 text-xs font-medium text-ink-3">
          <span>Lines ({so.lines.length})</span>
          {so.status === "draft" && (
            <button
              onClick={() => setAddingLine(a => !a)}
              className="rounded-xs px-2 py-1 text-xs text-accent hover:bg-accent/10"
            >
              {addingLine ? "Cancel" : "+ Add Line"}
            </button>
          )}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Item / Description</th>
              <th className="px-3 py-2 text-right">Qty Ordered</th>
              <th className="px-3 py-2 text-right">Qty Shipped</th>
              <th className="px-3 py-2 text-right">Unit Price</th>
              <th className="px-3 py-2">Notes</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {so.lines.map((l) => (
              <tr key={l.id} className="border-b border-line hover:bg-surface-2">
                <td className="px-3 py-2 font-mono text-ink-3">{l.lineNo}</td>
                <td className="px-3 py-2 text-ink">{l.itemDesc}</td>
                <td className="px-3 py-2 text-right font-mono text-ink">{l.qtyOrdered.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-ink-2">{l.qtyShipped.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono text-ink">{l.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-2 text-ink-2">{l.notes || "—"}</td>
                <td className="px-3 py-2" />
              </tr>
            ))}
            {addingLine && (
              <AddSOLineRow
                soId={so.id}
                onAdded={(line) => {
                  setSo(prev => ({ ...prev, lines: [...prev.lines, line] }));
                  setAddingLine(false);
                }}
              />
            )}
            {so.lines.length === 0 && !addingLine && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-xs text-ink-3">
                  No lines yet. Click "+ Add Line" to begin.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function SalesOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerMap, setCustomerMap] = useState<Map<string, Customer>>(new Map());
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSOOpen, setNewSOOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, custList] = await Promise.all([
        listSalesOrders({ status: statusFilter, limit: 100 }),
        customers.length === 0 ? listCustomers() : Promise.resolve(customers),
      ]);
      setOrders(res.items);
      setTotal(res.total);
      if (customers.length === 0) {
        setCustomers(custList);
        setCustomerMap(new Map(custList.map(c => [c.id, c])));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sales orders");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, customers]);

  useEffect(() => { void load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSelectSO(so: SalesOrder) {
    try {
      const full = await getSalesOrder(so.id);
      setSelected(full);
    } catch {
      setSelected(so);
    }
  }

  function handleCreated(so: SalesOrder) {
    setNewSOOpen(false);
    setOrders(prev => [so, ...prev]);
    void handleSelectSO(so);
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Sales Hub", href: "/sales/home" }, { label: "Sales Orders" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New SO", variant: "primary", onClick: () => setNewSOOpen(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      {/* Status filter */}
      <div className="flex items-center gap-1 border-b border-line bg-paper px-4 py-2">
        {SO_STATUSES.map(t => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-3">{total} orders</span>
      </div>

      {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {/* List + Detail */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: SO list */}
        <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-line">
          {loading && !orders.length ? (
            <div className="space-y-px">
              {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 animate-pulse border-b border-line bg-surface-2" />)}
            </div>
          ) : (
            <ul>
              {orders.map((so) => {
                const cust = customerMap.get(so.customerId);
                return (
                  <li
                    key={so.id}
                    onClick={() => router.push('/sales/orders/' + so.id)}
                    className={`cursor-pointer border-b border-line px-3 py-3 hover:bg-surface-2 ${selected?.id === so.id ? "bg-accent/5 border-l-2 border-l-accent" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-semibold text-ink">
                        {so.soNumber || so.id.slice(0, 8)}
                      </span>
                      <Tag tone={statusTone(so.status)}>{so.status}</Tag>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-2 truncate">
                      {cust ? `${cust.code} — ${cust.name}` : "—"}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-3">
                      {so.orderDate ? new Date(so.orderDate).toLocaleDateString() : "—"}
                    </div>
                  </li>
                );
              })}
              {!loading && orders.length === 0 && (
                <li className="px-4 py-8 text-center text-xs text-ink-3">No sales orders.</li>
              )}
            </ul>
          )}
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-auto">
          {selected ? (
            <SODetail
              so={selected}
              customerMap={customerMap}
              onStatusChanged={(updated) => {
                setSelected(updated);
                setOrders(prev => {
                  const idx = prev.findIndex(o => o.id === updated.id);
                  if (idx >= 0) { const n = [...prev]; n[idx] = updated; return n; }
                  return prev;
                });
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-3">
              Select a sales order to view details
            </div>
          )}
        </div>
      </div>

      <NewSODialog
        open={newSOOpen}
        customers={customers}
        onClose={() => setNewSOOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
