"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listPayslips,
  listLeaveRequests,
  createLeaveRequest,
  type Payslip,
  type PayslipStatus,
  type LeaveRequest,
} from "@/lib/api/hr";

// ─── types ──────────────────────────────────────────────────────────────────

type LeaveStatus = LeaveRequest["status"];
type LeaveType = LeaveRequest["leave_type"];

// ─── constants ───────────────────────────────────────────────────────────────

const LEAVE_STATUS_COLORS: Record<LeaveStatus, string> = {
  pending:   "bg-amber-100 text-amber-700",
  approved:  "bg-green-100 text-green-700",
  rejected:  "bg-red-100   text-red-700",
  cancelled: "bg-zinc-100  text-zinc-500",
};

const PAYSLIP_STATUS_COLORS: Record<PayslipStatus, string> = {
  draft:    "bg-zinc-100 text-zinc-500",
  approved: "bg-blue-100 text-blue-700",
  paid:     "bg-green-100 text-green-700",
};

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: "annual",    label: "Annual Leave"    },
  { value: "sick",      label: "Sick Leave"      },
  { value: "maternity", label: "Maternity Leave" },
  { value: "paternity", label: "Paternity Leave" },
  { value: "unpaid",    label: "Unpaid Leave"    },
  { value: "other",     label: "Other"           },
];

// ─── sub-components ──────────────────────────────────────────────────────────

function SummaryTile({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="border border-line bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-widest text-ink-3">{label}</div>
      <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

function formatPeriod(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return monthFmt.format(s);
  }
  return `${monthFmt.format(s)} – ${monthFmt.format(e)}`;
}

function formatCurrency(amount: number, currency = "THB"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function HRSelfServicePage() {
  const [tab, setTab] = useState<"payslips" | "leave">("payslips");
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  // Leave request form state
  const [showForm, setShowForm] = useState(false);
  const [formLeaveType, setFormLeaveType] = useState<LeaveType>("annual");
  const [formStartDate, setFormStartDate] = useState("");
  const [formEndDate, setFormEndDate] = useState("");
  const [formReason, setFormReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      listPayslips({ limit: 50 }).then(r => setPayslips(r.items)),
      listLeaveRequests({ limit: 100 }).then(r => setLeaves(r.items)),
    ]).finally(() => setLoading(false));
  }, []);

  // Summary metrics
  const annualUsed = useMemo(() =>
    leaves
      .filter(l => l.leave_type === "annual" && l.status === "approved")
      .reduce((acc, l) => acc + l.days, 0),
    [leaves]
  );

  const sickUsed = useMemo(() =>
    leaves
      .filter(l => l.leave_type === "sick" && l.status === "approved")
      .reduce((acc, l) => acc + l.days, 0),
    [leaves]
  );

  const pendingCount = useMemo(() =>
    leaves.filter(l => l.status === "pending").length,
    [leaves]
  );

  const sortedPayslips = useMemo(() =>
    [...payslips].sort((a, b) => b.period_start.localeCompare(a.period_start)),
    [payslips]
  );

  const sortedLeaves = useMemo(() =>
    [...leaves].sort((a, b) => b.start_date.localeCompare(a.start_date)),
    [leaves]
  );

  async function handleSubmitLeave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!formStartDate || !formEndDate) {
      setFormError("Start and end dates are required.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await createLeaveRequest({
        employee_id: "me", // placeholder — real impl binds to session user
        leave_type: formLeaveType,
        start_date: formStartDate,
        end_date: formEndDate,
        reason: formReason || undefined,
      });
      setLeaves(prev => [created, ...prev]);
      setShowForm(false);
      setFormLeaveType("annual");
      setFormStartDate("");
      setFormEndDate("");
      setFormReason("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to submit leave request.");
    } finally {
      setSubmitting(false);
    }
  }

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "HR Hub", href: "/hr/home" }, { label: "Self Service" }]} />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-base font-semibold text-ink">My HR Self Service</h1>
          <span className="font-mono text-xs text-ink-3">{today}</span>
        </div>

        {/* Summary tiles */}
        <div className="grid grid-cols-3 gap-4">
          <SummaryTile
            label="Annual Leave Used"
            value={loading ? "—" : annualUsed}
            sub="approved days this year"
          />
          <SummaryTile
            label="Sick Leave Used"
            value={loading ? "—" : sickUsed}
            sub="approved days this year"
          />
          <SummaryTile
            label="Pending Requests"
            value={loading ? "—" : pendingCount}
            sub="awaiting approval"
          />
        </div>

        {/* Tabs */}
        <div className="border-b border-line flex gap-0">
          {(["payslips", "leave"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-xs font-medium uppercase tracking-widest border-b-2 -mb-px transition-colors ${
                tab === t
                  ? "border-accent text-ink"
                  : "border-transparent text-ink-3 hover:text-ink"
              }`}
            >
              {t === "payslips" ? "My Payslips" : "Leave Requests"}
            </button>
          ))}
        </div>

        {/* Payslips tab */}
        {tab === "payslips" && (
          <div className="border border-line overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/30 border-b border-line">
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Period</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-widest text-ink-3">Base Salary</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-widest text-ink-3">Allowances</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-widest text-ink-3">Deductions</th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-widest text-ink-3">Net Pay</th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-xs text-ink-3">
                      Loading...
                    </td>
                  </tr>
                )}
                {!loading && sortedPayslips.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-xs text-ink-3">
                      No payslips found
                    </td>
                  </tr>
                )}
                {!loading && sortedPayslips.map(p => (
                  <tr key={p.id} className="border-t border-line hover:bg-muted/20">
                    <td className="px-4 py-3 text-xs text-ink font-mono">
                      {formatPeriod(p.period_start, p.period_end)}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-right text-ink">
                      {formatCurrency(p.base_salary, p.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-right text-ink">
                      {formatCurrency(p.allowances, p.currency)}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-right text-red-600">
                      ({formatCurrency(p.deductions, p.currency)})
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-right font-semibold text-ink">
                      {formatCurrency(p.net_pay, p.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${PAYSLIP_STATUS_COLORS[p.status]}`}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Leave requests tab */}
        {tab === "leave" && (
          <div className="space-y-4">
            {/* Header with button */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-ink-3">{sortedLeaves.length} request{sortedLeaves.length !== 1 ? "s" : ""}</span>
              <button
                onClick={() => setShowForm(v => !v)}
                className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-accent/90 transition-colors"
              >
                {showForm ? "Cancel" : "+ Request Leave"}
              </button>
            </div>

            {/* Leave request form */}
            {showForm && (
              <form
                onSubmit={handleSubmitLeave}
                className="border border-line bg-surface p-5 space-y-4"
              >
                <h3 className="text-xs font-medium uppercase tracking-widest text-ink-3">New Leave Request</h3>

                {formError && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-ink-3 mb-1">Leave Type</label>
                    <select
                      value={formLeaveType}
                      onChange={e => setFormLeaveType(e.target.value as LeaveType)}
                      className="w-full border border-line bg-surface text-ink text-xs px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {LEAVE_TYPES.map(lt => (
                        <option key={lt.value} value={lt.value}>{lt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-ink-3 mb-1">Start Date</label>
                      <input
                        type="date"
                        value={formStartDate}
                        onChange={e => setFormStartDate(e.target.value)}
                        required
                        className="w-full border border-line bg-surface text-ink text-xs px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-ink-3 mb-1">End Date</label>
                      <input
                        type="date"
                        value={formEndDate}
                        min={formStartDate}
                        onChange={e => setFormEndDate(e.target.value)}
                        required
                        className="w-full border border-line bg-surface text-ink text-xs px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-ink-3 mb-1">Reason / Notes (optional)</label>
                  <textarea
                    value={formReason}
                    onChange={e => setFormReason(e.target.value)}
                    rows={3}
                    placeholder="Briefly describe the reason for leave..."
                    className="w-full border border-line bg-surface text-ink text-xs px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  />
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="px-4 py-1.5 text-xs text-ink-3 border border-line rounded hover:bg-muted/30 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? "Submitting..." : "Submit Request"}
                  </button>
                </div>
              </form>
            )}

            {/* Leave requests table */}
            <div className="border border-line overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-line">
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Type</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Start</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">End</th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-widest text-ink-3">Days</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Reason</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-xs text-ink-3">
                        Loading...
                      </td>
                    </tr>
                  )}
                  {!loading && sortedLeaves.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-xs text-ink-3">
                        No leave requests found
                      </td>
                    </tr>
                  )}
                  {!loading && sortedLeaves.map(lr => (
                    <tr key={lr.id} className="border-t border-line hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <span className="text-xs text-ink capitalize">
                          {lr.leave_type.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-ink">
                        {new Date(lr.start_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-ink">
                        {new Date(lr.end_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-right text-ink">
                        {lr.days}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-3 max-w-xs truncate">
                        {lr.reason || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${LEAVE_STATUS_COLORS[lr.status]}`}>
                          {lr.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
