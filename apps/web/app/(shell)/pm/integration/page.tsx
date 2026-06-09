"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";
import { listSalesOrders, type SalesOrder, type SOStatus } from "@/lib/api/sales";
import { listPurchaseOrders, listWorkOrders, type PurchaseOrder, type WorkOrder, type WOStatus } from "@/lib/api/mfg";

// ─── status colour mappings ────────────────────────────────────────────────

const SO_STATUS_TONE: Record<SOStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft:     "neutral",
  confirmed: "info",
  shipped:   "info",
  invoiced:  "success",
  cancelled: "danger",
};

const PO_STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft:      "neutral",
  submitted:  "info",
  approved:   "info",
  received:   "success",
  cancelled:  "danger",
};

const WO_STATUS_TONE: Record<WOStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  planned:     "neutral",
  released:    "info",
  in_progress: "warning",
  completed:   "success",
  closed:      "success",
  cancelled:   "danger",
};

// ─── skeleton loader ───────────────────────────────────────────────────────

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-sm bg-surface-2 border border-line" />
      ))}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString(); } catch { return d; }
}

/** Real linkage: PO.sourceSoId FK points back to the originating sales order. */
function filterLinkedPOs(pos: PurchaseOrder[], so: SalesOrder): PurchaseOrder[] {
  return pos.filter(po => po.sourceSoId === so.id);
}

/** Real linkage: WO.sourceSoId FK points back to the originating sales order. */
function filterLinkedWOs(wos: WorkOrder[], so: SalesOrder): WorkOrder[] {
  return wos.filter(wo => wo.sourceSoId === so.id);
}

// ─── column header ─────────────────────────────────────────────────────────

function ColHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center justify-between border-b border-line pb-2 mb-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-3">{title}</span>
      {count !== undefined && (
        <span className="font-mono text-[10px] text-ink-3">{count}</span>
      )}
    </div>
  );
}

// ─── SO card ───────────────────────────────────────────────────────────────

function SOCard({
  so,
  selected,
  onClick,
}: {
  so: SalesOrder;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left border rounded-sm p-3 mb-1 transition-colors",
        selected
          ? "bg-accent/10 border-accent"
          : "border-line bg-surface hover:bg-surface-2",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-ink">{so.soNumber || so.id.slice(0, 8).toUpperCase()}</span>
        <Tag tone={SO_STATUS_TONE[so.status]}>{so.status}</Tag>
      </div>
      <div className="mt-1 text-[11px] text-ink-2 truncate">
        Customer ID: <span className="font-mono text-ink-3">{so.customerId.slice(0, 8)}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-ink-3">{fmtDate(so.orderDate)}</div>
    </button>
  );
}

// ─── PO card ───────────────────────────────────────────────────────────────

function POCard({ po }: { po: PurchaseOrder }) {
  return (
    <Link
      href={`/mfg/purchase-orders/${po.id}`}
      className="block border border-line bg-surface rounded-sm p-3 mb-1 hover:bg-surface-2 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-ink">{po.poNumber || po.id.slice(0, 8).toUpperCase()}</span>
        <Tag tone={PO_STATUS_TONE[po.status] ?? "neutral"}>{po.status}</Tag>
      </div>
      <div className="mt-1 text-[11px] text-ink-2 truncate">
        Supplier: <span className="font-mono text-ink-3">{po.supplierId.slice(0, 8)}</span>
      </div>
      <div className="mt-0.5 text-[10px] text-ink-3">
        Ordered {fmtDate(po.orderDate)}
        {po.expectedDate ? <span className="ml-2">· Expected {fmtDate(po.expectedDate)}</span> : null}
      </div>
    </Link>
  );
}

// ─── WO card ───────────────────────────────────────────────────────────────

function WOCard({ wo }: { wo: WorkOrder }) {
  return (
    <Link
      href={`/mfg/work-orders/${wo.id}`}
      className="block border border-line bg-surface rounded-sm p-3 mb-1 hover:bg-surface-2 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-ink">{wo.code}</span>
        <Tag tone={WO_STATUS_TONE[wo.status]}>{wo.status}</Tag>
      </div>
      <div className="mt-1 text-[11px] text-ink-2 truncate">
        Item: <span className="font-mono text-ink-3">{wo.itemId.slice(0, 8)}</span>
        <span className="ml-2">Qty: <span className="font-mono">{wo.qty}</span></span>
      </div>
      <div className="mt-0.5 text-[10px] text-ink-3">
        Due {fmtDate(wo.dueDate)}
        <span className="ml-2 capitalize">· {wo.priority}</span>
      </div>
    </Link>
  );
}

// ─── empty state ───────────────────────────────────────────────────────────

function LinkedEmpty({ message, linkHref, linkLabel }: { message: string; linkHref: string; linkLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <p className="text-xs text-ink-3">{message}</p>
      <Link
        href={linkHref}
        className="rounded-sm border border-line bg-surface px-3 py-1.5 text-xs text-ink hover:bg-surface-2 transition-colors"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

// ─── main page ─────────────────────────────────────────────────────────────

export default function OrderIntegrationPage() {
  const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([]);
  const [allPOs, setAllPOs] = useState<PurchaseOrder[]>([]);
  const [allWOs, setAllWOs] = useState<WorkOrder[]>([]);
  const [selectedSO, setSelectedSO] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [soRes, poRes, woRes] = await Promise.all([
        listSalesOrders({ limit: 100 }),
        listPurchaseOrders({ limit: 100 }),
        listWorkOrders({ limit: 100 }),
      ]);
      setSalesOrders(soRes.items);
      setAllPOs(poRes.items);
      setAllWOs(woRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const linkedPOs = selectedSO ? filterLinkedPOs(allPOs, selectedSO) : [];
  const linkedWOs = selectedSO ? filterLinkedWOs(allWOs, selectedSO) : [];

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[
          { label: "PM Hub", href: "/pm/home" },
          { label: "Order Integration" },
        ]}
      />

      {/* Page title bar */}
      <div className="flex items-center gap-4 border-b border-line bg-paper px-4 py-2">
        <span className="text-sm font-semibold text-ink">Order Integration View</span>
        <span className="text-xs text-ink-3">Sales Orders — Purchase Orders — Work Orders</span>
        <button
          type="button"
          onClick={load}
          className="ml-auto rounded-sm border border-line bg-surface px-3 py-1 text-xs text-ink hover:bg-surface-2 transition-colors"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-sm bg-danger/10 px-4 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Three-column layout */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* ── Column 1: Sales Orders ── */}
        <div className="flex w-1/3 min-w-0 flex-col border-r border-line">
          <div className="px-3 pt-3">
            <ColHeader title="Sales Orders" count={loading ? undefined : salesOrders.length} />
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {loading ? (
              <SkeletonRows />
            ) : salesOrders.length === 0 ? (
              <div className="py-8 text-center text-xs text-ink-3">No sales orders found.</div>
            ) : (
              salesOrders.map(so => (
                <SOCard
                  key={so.id}
                  so={so}
                  selected={selectedSO?.id === so.id}
                  onClick={() => setSelectedSO(prev => prev?.id === so.id ? null : so)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Column 2: Purchase Orders ── */}
        <div className="flex w-1/3 min-w-0 flex-col border-r border-line">
          <div className="px-3 pt-3">
            <ColHeader
              title="Related Purchase Orders"
              count={selectedSO ? linkedPOs.length : undefined}
            />
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {!selectedSO ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-xs text-ink-3">Select a Sales Order to view related records</p>
              </div>
            ) : loading ? (
              <SkeletonRows count={3} />
            ) : linkedPOs.length === 0 ? (
              <LinkedEmpty
                message="No linked Purchase Orders found."
                linkHref="/mfg/purchase-orders"
                linkLabel="Create a Purchase Order"
              />
            ) : (
              linkedPOs.map(po => <POCard key={po.id} po={po} />)
            )}
          </div>
        </div>

        {/* ── Column 3: Work Orders ── */}
        <div className="flex w-1/3 min-w-0 flex-col">
          <div className="px-3 pt-3">
            <ColHeader
              title="Related Work Orders"
              count={selectedSO ? linkedWOs.length : undefined}
            />
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {!selectedSO ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-xs text-ink-3">Select a Sales Order to view related records</p>
              </div>
            ) : loading ? (
              <SkeletonRows count={3} />
            ) : linkedWOs.length === 0 ? (
              <LinkedEmpty
                message="No linked Work Orders found."
                linkHref="/mfg/work-orders"
                linkLabel="View Work Orders"
              />
            ) : (
              linkedWOs.map(wo => <WOCard key={wo.id} wo={wo} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
