"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listInvoices, type Invoice, type InvType } from "@/lib/api/accounting";
import { listCustomers, type Customer } from "@/lib/api/sales";

type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";

function getBucket(dueDate: string): AgingBucket {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate);
  const diffDays = Math.floor((today.getTime() - due.getTime()) / 86400000);
  if (diffDays <= 0) return "current";
  if (diffDays <= 30) return "1-30";
  if (diffDays <= 60) return "31-60";
  if (diffDays <= 90) return "61-90";
  return "90+";
}

const BUCKET_LABELS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

// Severity ramp using design tokens only (no raw Tailwind palette colors).
const BUCKET_COLORS: Record<AgingBucket, string> = {
  current: "text-success",
  "1-30": "text-info",
  "31-60": "text-warning",
  "61-90": "text-danger",
  "90+": "text-danger",
};

export default function AgingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tab, setTab] = useState<InvType>("AR");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listInvoices({ type: "AR" }).then(r => r.items),
      listInvoices({ type: "AP" }).then(r => r.items),
      listCustomers().catch(() => [] as Customer[]),
    ]).then(([ar, ap, custs]) => { setInvoices([...ar, ...ap]); setCustomers(custs); })
      .finally(() => setLoading(false));
  }, []);

  const cpName = (inv: Invoice) =>
    inv.counterpartyName || customers.find(c => c.id === inv.counterpartyId)?.name || inv.counterpartyId;

  const outstanding = useMemo(() =>
    invoices.filter(inv => inv.invType === tab && (inv.status === "issued" || inv.status === "overdue")),
    [invoices, tab]
  );

  const byCounterparty = useMemo(() => {
    const map = new Map<string, Record<AgingBucket, number> & { total: number }>();
    for (const inv of outstanding) {
      const key = cpName(inv);
      if (!map.has(key)) {
        map.set(key, { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 });
      }
      const row = map.get(key)!;
      const bucket = getBucket(inv.dueDate);
      row[bucket] += inv.amount;
      row.total += inv.amount;
    }
    return Array.from(map.entries())
      .map(([name, buckets]) => ({ name, ...buckets }))
      .sort((a, b) => b.total - a.total);
  }, [outstanding]);

  const totals = useMemo(() =>
    BUCKET_LABELS.reduce((acc, b) => {
      acc[b] = byCounterparty.reduce((s, r) => s + r[b], 0);
      return acc;
    }, {} as Record<AgingBucket, number>),
    [byCounterparty]
  );

  const grandTotal = BUCKET_LABELS.reduce((s, b) => s + (totals[b] ?? 0), 0);

  const fmt = (n: number) =>
    n === 0 ? "—" : n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Accounting" }, { label: "AR/AP Aging" }]} />

      <div className="flex gap-1">
        {(["AR", "AP"] as InvType[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-md border transition-colors ${tab === t ? "bg-accent text-white border-accent" : "border-line text-ink-3 hover:bg-surface-2"}`}>
            {t === "AR" ? "Accounts Receivable" : "Accounts Payable"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-3">
        {BUCKET_LABELS.map(b => (
          <div key={b} className="rounded-lg border border-line bg-surface p-3">
            <div className="text-xs text-ink-3 mb-1">
              {b === "current" ? "Current" : `${b} days`}
            </div>
            <div className={`text-lg font-mono font-semibold ${BUCKET_COLORS[b]}`}>
              {fmt(totals[b] ?? 0)}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-line bg-surface px-4 py-3 flex items-center justify-between">
        <span className="text-sm font-medium">Total Outstanding</span>
        <span className="text-xl font-mono font-bold">{fmt(grandTotal)}</span>
      </div>

      {loading ? (
        <div className="text-sm text-ink-3">Loading...</div>
      ) : (
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">{tab === "AR" ? "Customer" : "Supplier"}</th>
                {BUCKET_LABELS.map(b => (
                  <th key={b} className="px-4 py-2 text-right font-medium">
                    {b === "current" ? "Current" : `${b}d`}
                  </th>
                ))}
                <th className="px-4 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {byCounterparty.length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-3">No outstanding invoices</td></tr>
              )}
              {byCounterparty.map(row => (
                <tr key={row.name} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  {BUCKET_LABELS.map(b => (
                    <td key={b} className={`px-4 py-3 text-right font-mono text-xs ${row[b] > 0 ? BUCKET_COLORS[b] : "text-ink-3"}`}>
                      {fmt(row[b])}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-mono font-semibold">{fmt(row.total)}</td>
                </tr>
              ))}
              {byCounterparty.length > 0 && (
                <tr className="border-t-2 border-line bg-surface-2 font-semibold">
                  <td className="px-4 py-3">Total</td>
                  {BUCKET_LABELS.map(b => (
                    <td key={b} className={`px-4 py-3 text-right font-mono text-xs ${BUCKET_COLORS[b]}`}>
                      {fmt(totals[b] ?? 0)}
                    </td>
                  ))}
                  <td className="px-4 py-3 text-right font-mono">{fmt(grandTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
