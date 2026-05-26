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
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-600",
  cancelled: "bg-zinc-100 text-zinc-500",
};

const PAYSLIP_COLORS: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
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

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!employee) return <div className="p-6 text-sm text-red-600">Employee not found</div>;

  const totalDaysLeave = leaves.filter(l => l.status === "approved").reduce((s, l) => s + l.days, 0);
  const lastPayslip = payslips[0];

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Employees", href: "/hr/employees" }, { label: `${employee.firstName} ${employee.lastName}` }]} />

      <div className="rounded-lg border border-border bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-semibold">{employee.firstName} {employee.lastName}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${employee.status === "active" ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>{employee.status}</span>
          </div>
          <div className="text-sm text-muted-foreground space-y-0.5">
            <div className="font-mono text-xs">{employee.empNo}</div>
            {employee.positionName && <div>{employee.positionName}</div>}
            {employee.departmentName && <div>{employee.departmentName}</div>}
            <div>{employee.email}</div>
            <div className="text-xs">Hired: {employee.hireDate?.slice(0, 10)}</div>
          </div>
        </div>
        <button onClick={() => router.back()} className="text-xs text-muted-foreground hover:text-foreground border border-border px-3 py-1.5 rounded">← Back</button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Payslips</div>
          <div className="text-2xl font-mono font-bold">{payslips.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Leave Days (approved)</div>
          <div className="text-2xl font-mono font-bold">{totalDaysLeave}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Last Net Pay</div>
          <div className="text-2xl font-mono font-bold text-green-600">{lastPayslip ? fmt(lastPayslip.net_pay) : "—"}</div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(["overview", "payslips", "leave"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize ${tab === t ? "border-accent text-accent" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
            {t}{t === "payslips" ? ` (${payslips.length})` : t === "leave" ? ` (${leaves.length})` : ""}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="rounded-lg border border-border bg-surface p-5 grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-muted-foreground">Employee #:</span> <span className="font-mono">{employee.empNo}</span></div>
          <div><span className="text-muted-foreground">Status:</span> {employee.status}</div>
          <div><span className="text-muted-foreground">Department:</span> {employee.departmentName ?? "—"}</div>
          <div><span className="text-muted-foreground">Position:</span> {employee.positionName ?? "—"}</div>
          <div><span className="text-muted-foreground">Email:</span> {employee.email}</div>
          <div><span className="text-muted-foreground">Hire Date:</span> {employee.hireDate?.slice(0, 10)}</div>
          {employee.terminationDate && <div><span className="text-muted-foreground">Termination:</span> {employee.terminationDate?.slice(0, 10)}</div>}
        </div>
      )}

      {tab === "payslips" && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Base</th>
                <th className="px-4 py-2 text-right font-medium">Allowances</th>
                <th className="px-4 py-2 text-right font-medium">Deductions</th>
                <th className="px-4 py-2 text-right font-medium">Net Pay</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {payslips.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No payslips</td></tr>}
              {payslips.map(p => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs">{p.period_start?.slice(0, 7)} → {p.period_end?.slice(0, 7)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{fmt(p.base_salary)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-green-700">+{fmt(p.allowances)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs text-red-600">-{fmt(p.deductions)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-bold">{fmt(p.net_pay)}</td>
                  <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-xs ${PAYSLIP_COLORS[p.status] ?? ""}`}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "leave" && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Type</th>
                <th className="px-4 py-2 text-left font-medium">From</th>
                <th className="px-4 py-2 text-left font-medium">To</th>
                <th className="px-4 py-2 text-right font-medium">Days</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {leaves.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No leave requests</td></tr>}
              {leaves.map(l => (
                <tr key={l.id} className="border-t border-border hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs capitalize">{l.leave_type.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-xs">{l.start_date?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-xs">{l.end_date?.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{l.days}</td>
                  <td className="px-4 py-3"><span className={`px-1.5 py-0.5 rounded text-xs ${LEAVE_COLORS[l.status] ?? ""}`}>{l.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
