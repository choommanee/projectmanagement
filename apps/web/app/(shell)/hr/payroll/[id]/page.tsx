"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getPayslip, approvePayslip, markPayslipPaid, type Payslip, type PayslipStatus } from "@/lib/api/hr";

export default function PayslipDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ps, setPs] = useState<Payslip | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getPayslip(id).then(setPs).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  async function handleApprove() {
    if (!ps) return;
    setSaving(true);
    try { setPs(await approvePayslip(ps.id)); } finally { setSaving(false); }
  }

  async function handlePaid() {
    if (!ps) return;
    setSaving(true);
    try { setPs(await markPayslipPaid(ps.id)); } finally { setSaving(false); }
  }

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!ps) return <div className="p-8 text-destructive">Payslip not found.</div>;

  const statusColors: Record<PayslipStatus, string> = {
    draft: "bg-muted text-ink-3",
    approved: "bg-blue-100 text-blue-800",
    paid: "bg-green-100 text-green-800",
  };

  const gross = ps.base_salary + ps.allowances;
  const fmt = (n: number) => `${ps.currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/hr/payroll")} className="hover:underline">Payslips</button>
        <span className="mx-2">/</span>
        <span>{ps.period_start} – {ps.period_end}</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Payslip</h1>
            <p className="text-sm text-ink-3 mt-1">{ps.period_start} – {ps.period_end}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusColors[ps.status]}`}>
            {ps.status}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {ps.status === "draft" && (
            <button onClick={handleApprove} disabled={saving}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              Approve
            </button>
          )}
          {ps.status === "approved" && (
            <button onClick={handlePaid} disabled={saving}
              className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
              Mark Paid
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Base Salary", value: fmt(ps.base_salary) },
          { label: "Allowances", value: fmt(ps.allowances) },
          { label: "Gross Pay", value: fmt(gross) },
          { label: "Deductions", value: fmt(ps.deductions) },
          { label: "Net Pay", value: fmt(ps.net_pay) },
          { label: "Currency", value: ps.currency },
          { label: "Approved By", value: ps.approved_by ?? "—" },
          { label: "Paid At", value: ps.paid_at ? ps.paid_at.slice(0, 10) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-line bg-card p-4">
            <p className="text-xs text-ink-3 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-semibold font-mono">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-line bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3 mb-4">Pay Summary</h2>
        <table className="w-full text-sm">
          <tbody>
            {[
              { label: "Base Salary", amount: ps.base_salary, type: "neutral" },
              { label: "Allowances", amount: ps.allowances, type: "positive" },
              { label: "Gross Pay", amount: gross, type: "total" },
              { label: "Deductions", amount: -ps.deductions, type: "negative" },
              { label: "Net Pay", amount: ps.net_pay, type: "total" },
            ].map(({ label, amount, type }) => (
              <tr key={label} className={`border-t border-line ${type === "total" ? "font-semibold" : ""}`}>
                <td className="py-2 pr-4">{label}</td>
                <td className={`py-2 text-right font-mono ${type === "negative" ? "text-destructive" : type === "positive" ? "text-green-600" : ""}`}>
                  {amount < 0 ? `-${fmt(-amount)}` : fmt(amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
