"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  getEmployee, listPayslips, listLeaveRequests,
  type Employee, type Payslip, type LeaveRequest,
} from "@/lib/api/hr";

type Tab = "overview" | "payslips" | "leave";

const LEAVE_COLORS: Record<string, string> = {
  pending:   "bg-warning/10 text-warning",
  approved:  "bg-success/10 text-success",
  rejected:  "bg-danger/10 text-danger",
  cancelled: "bg-surface-2 text-ink-3",
};

const PAYSLIP_COLORS: Record<string, string> = {
  draft:    "bg-surface-2 text-ink-3",
  approved: "bg-accent/10 text-accent",
  paid:     "bg-success/10 text-success",
};

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getEmployee(id).then(setEmployee),
      listPayslips({ employee_id: id }).then(r => setPayslips(r.items)),
      listLeaveRequests({ employee_id: id }).then(r => setLeaves(r.items)),
    ]).finally(() => setLoading(false));
  }, [id]);

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!employee) return <div className="p-6 text-sm text-danger">Employee not found</div>;

  const totalDaysLeave = leaves.filter(l => l.status === "approved").reduce((s, l) => s + l.days, 0);
  const lastPayslip = payslips[0];

  return (
    <div className="flex h-full flex-col overflow-auto p-6 space-y-5">
      <Breadcrumb items={[
        { label: "HR" },
        { label: "Employees", href: "/hr/employees" },
        { label: `${employee.firstName} ${employee.lastName}` },
      ]} />

      {/* Header card */}
      <div className="rounded-md border border-line bg-paper p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold text-ink">{employee.firstName} {employee.lastName}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${employee.status === "active" ? "bg-success/10 text-success" : "bg-surface-2 text-ink-3"}`}>
              {employee.status}
            </span>
          </div>
          <div className="space-y-0.5 text-sm text-ink-2">
            <div className="font-mono text-xs text-ink-3">{employee.empNo}</div>
            {employee.positionName && <div>{employee.positionName}</div>}
            {employee.departmentName && <div>{employee.departmentName}</div>}
            <div>{employee.email}</div>
            <div className="text-xs">Hired: {employee.hireDate?.slice(0, 10)}</div>
          </div>
        </div>
        <button
          onClick={() => router.back()}
          className="rounded border border-line px-3 py-1.5 text-xs text-ink-3 hover:text-ink"
        >
          ← Back
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Payslips", value: String(payslips.length), tone: "" },
          { label: "Leave Days (approved)", value: String(totalDaysLeave), tone: "" },
          { label: "Last Net Pay", value: lastPayslip ? fmt(lastPayslip.net_pay) : "—", tone: "text-success" },
        ].map(({ label, value, tone }) => (
          <div key={label} className="rounded-md border border-line bg-paper p-4">
            <p className="text-[10px] uppercase tracking-widest text-ink-3">{label}</p>
            <p className={`mt-1 font-mono text-2xl font-bold ${tone || "text-ink"}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line">
        {(["overview", "payslips", "leave"] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? "border-accent text-accent" : "border-transparent text-ink-3 hover:text-ink"
            }`}
          >
            {t}
            {t === "payslips" ? ` (${payslips.length})` : t === "leave" ? ` (${leaves.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="rounded-md border border-line bg-paper p-5 grid grid-cols-2 gap-y-3 gap-x-6 text-sm">
          {[
            ["Employee #", employee.empNo],
            ["Status", employee.status],
            ["Department", employee.departmentName ?? "—"],
            ["Position", employee.positionName ?? "—"],
            ["Email", employee.email],
            ["Hire Date", employee.hireDate?.slice(0, 10)],
            ...(employee.terminationDate ? [["Termination", employee.terminationDate?.slice(0, 10)]] : []),
          ].map(([label, value]) => (
            <div key={label}>
              <span className="text-ink-3">{label}: </span>
              <span className="font-medium text-ink">{value}</span>
            </div>
          ))}
        </div>
      )}

      {tab === "payslips" && (
        <div className="rounded-md border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs font-medium uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left">Period</th>
                <th className="px-4 py-2 text-right">Base</th>
                <th className="px-4 py-2 text-right">Allowances</th>
                <th className="px-4 py-2 text-right">Deductions</th>
                <th className="px-4 py-2 text-right">Net Pay</th>
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {payslips.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-ink-3">No payslips</td></tr>
              )}
              {payslips.map(p => (
                <tr key={p.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3 text-xs text-ink">{p.period_start?.slice(0, 7)} → {p.period_end?.slice(0, 7)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-ink">{fmt(p.base_salary)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-success">+{fmt(p.allowances)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-danger">-{fmt(p.deductions)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-bold text-ink">{fmt(p.net_pay)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${PAYSLIP_COLORS[p.status] ?? "bg-surface-2 text-ink-3"}`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "leave" && (
        <div className="rounded-md border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs font-medium uppercase tracking-wide text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-left">From</th>
                <th className="px-4 py-2 text-left">To</th>
                <th className="px-4 py-2 text-right">Days</th>
                <th className="px-4 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {leaves.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-ink-3">No leave requests</td></tr>
              )}
              {leaves.map(l => (
                <tr key={l.id} className="border-b border-line last:border-0 hover:bg-surface-2">
                  <td className="px-4 py-3 text-xs capitalize text-ink">{l.leave_type.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-xs text-ink-2">{l.start_date?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs text-ink-2">{l.end_date?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-ink">{l.days}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${LEAVE_COLORS[l.status] ?? "bg-surface-2 text-ink-3"}`}>
                      {l.status}
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
