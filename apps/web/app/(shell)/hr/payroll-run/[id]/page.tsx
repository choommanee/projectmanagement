"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getPayrollRun, listPayslips, type PayrollRun, type Payslip } from "@/lib/api/hr";

type RunStatus = PayrollRun["status"];

export default function PayrollRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    getPayrollRun(id)
      .then(async r => {
        setRun(r);
        // load payslips for the run period
        const ps = await listPayslips({ limit: 200 });
        // filter client-side to this run's period
        setPayslips(ps.items.filter(p =>
          p.period_start === r.period_start && p.period_end === r.period_end
        ));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!run) return <div className="p-8 text-destructive">Payroll run not found.</div>;

  const statusColors: Record<RunStatus, string> = {
    draft: "bg-muted text-ink-3",
    processing: "bg-yellow-100 text-yellow-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-gray-200 text-gray-500",
  };

  const fmt = (n: number) => `฿${n.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/hr/payroll-run")} className="hover:underline">Payroll Runs</button>
        <span className="mx-2">/</span>
        <span>{run.period_start} – {run.period_end}</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Payroll Run</h1>
            <p className="text-sm text-ink-3 mt-1">{run.period_start} – {run.period_end}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusColors[run.status]}`}>
            {run.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Employees", value: String(run.total_employees) },
          { label: "Total Net Pay", value: fmt(run.total_net_pay) },
          { label: "Period Start", value: run.period_start },
          { label: "Period End", value: run.period_end },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-line bg-card p-4">
            <p className="text-xs text-ink-3 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-semibold font-mono">{value}</p>
          </div>
        ))}
      </div>

      {payslips.length > 0 && (
        <div className="rounded-lg border border-line bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3 mb-4">
            Payslips ({payslips.length})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-3 text-xs uppercase">
                <th className="py-2 pr-4">Employee ID</th>
                <th className="py-2 pr-4 text-right">Net Pay</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {payslips.map(ps => (
                <tr key={ps.id} className="border-t border-line hover:bg-surface-2 cursor-pointer"
                  onClick={() => router.push('/hr/payroll/' + ps.id)}>
                  <td className="py-2 pr-4 font-mono text-sm">{ps.employee_id}</td>
                  <td className="py-2 pr-4 text-right font-mono">{fmt(ps.net_pay)}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${ps.status === 'paid' ? 'bg-green-100 text-green-800' : ps.status === 'approved' ? 'bg-blue-100 text-blue-800' : 'bg-muted text-ink-3'}`}>
                      {ps.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
