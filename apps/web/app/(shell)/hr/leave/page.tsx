"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar, type CommandAction } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listLeaveRequests,
  createLeaveRequest,
  approveLeaveRequest,
  rejectLeaveRequest,
  type LeaveRequest,
} from "@/lib/api/hr";

type LeaveStatus = LeaveRequest["status"];
type LeaveType = LeaveRequest["leave_type"];

const STATUS_TABS: { value: LeaveStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "cancelled", label: "Cancelled" },
];

const LEAVE_TYPES: { value: LeaveType; label: string }[] = [
  { value: "annual", label: "Annual" },
  { value: "sick", label: "Sick" },
  { value: "maternity", label: "Maternity" },
  { value: "paternity", label: "Paternity" },
  { value: "unpaid", label: "Unpaid" },
  { value: "other", label: "Other" },
];

function statusTone(
  s: LeaveStatus
): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "pending") return "warning";
  if (s === "approved") return "success";
  if (s === "rejected") return "danger";
  return "neutral";
}

function leaveTypeTone(
  t: LeaveType
): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (t === "annual") return "info";
  if (t === "sick") return "warning";
  if (t === "maternity") return "accent";
  if (t === "paternity") return "accent";
  if (t === "unpaid") return "neutral";
  return "neutral";
}

function fmtDate(d: string): string {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return d;
  }
}

const TODAY = new Date().toISOString().split("T")[0];

type CreateFormData = {
  employee_id: string;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
};

const EMPTY_FORM: CreateFormData = {
  employee_id: "",
  leave_type: "annual",
  start_date: TODAY,
  end_date: TODAY,
  reason: "",
};

function RequestLeaveDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (lr: LeaveRequest) => void;
}) {
  const [form, setForm] = useState<CreateFormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setError(null);
    }
  }, [open]);

  const set =
    (k: keyof CreateFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.employee_id.trim()) {
      setError("Employee ID is required");
      return;
    }
    if (!form.start_date || !form.end_date) {
      setError("Start date and end date are required");
      return;
    }
    if (form.end_date < form.start_date) {
      setError("End date must be on or after start date");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const lr = await createLeaveRequest({
        employee_id: form.employee_id.trim(),
        leave_type: form.leave_type,
        start_date: form.start_date,
        end_date: form.end_date,
        reason: form.reason || undefined,
      });
      onSaved(lr);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create leave request");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Request Leave">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 min-w-[360px]">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            Employee ID
          </label>
          <Input
            placeholder="UUID of employee"
            value={form.employee_id}
            onChange={set("employee_id")}
            required
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            Leave Type
          </label>
          <select
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
            value={form.leave_type}
            onChange={set("leave_type")}
          >
            {LEAVE_TYPES.map((lt) => (
              <option key={lt.value} value={lt.value}>
                {lt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Start Date
            </label>
            <Input type="date" value={form.start_date} onChange={set("start_date")} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              End Date
            </label>
            <Input type="date" value={form.end_date} onChange={set("end_date")} required />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            Reason (optional)
          </label>
          <textarea
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm resize-none"
            rows={3}
            placeholder="Reason for leave…"
            value={form.reason}
            onChange={set("reason")}
          />
        </div>

        {error && <p className="text-xs text-[var(--color-danger)]">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? "Submitting…" : "Submit Request"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function RejectDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      onConfirm(reason);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Reject Leave Request">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 min-w-[320px]">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            Reason for rejection
          </label>
          <textarea
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm resize-none"
            rows={3}
            placeholder="Provide a reason…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? "Rejecting…" : "Confirm Reject"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function LeaveRequestsPage() {
  const [items, setItems] = useState<LeaveRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | "">("");
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);

  const commands: CommandAction[] = [
    {
      id: "request-leave",
      label: "+ Request Leave",
      variant: "primary",
      onClick: () => setDialogOpen(true),
    },
  ];

  const load = useCallback(async (status: LeaveStatus | "") => {
    setLoading(true);
    try {
      const res = await listLeaveRequests(status ? { status } : {});
      setItems(res.items);
      setTotal(res.total);
    } catch {
      // silently degrade
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(statusFilter);
  }, [load, statusFilter]);

  function handleSaved(lr: LeaveRequest) {
    setDialogOpen(false);
    setItems((prev) => [lr, ...prev]);
    setTotal((t) => t + 1);
  }

  async function handleApprove(id: string) {
    setActionLoading(id + "-approve");
    try {
      const updated = await approveLeaveRequest(id);
      setItems((prev) => prev.map((lr) => (lr.id === id ? updated : lr)));
    } catch {
      // no-op
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id: string, reason: string) {
    setRejectTarget(null);
    setActionLoading(id + "-reject");
    try {
      const updated = await rejectLeaveRequest(id, reason);
      setItems((prev) => prev.map((lr) => (lr.id === id ? updated : lr)));
    } catch {
      // no-op
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <Breadcrumb
        items={[
          { label: "HR Hub", href: "/hr/home" },
          { label: "Leave Requests" },
        ]}
      />
      <CommandBar actions={commands} />

      {/* Status filter tabs */}
      <div className="flex gap-1 px-4 pt-3 border-b border-[var(--color-border)]">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={[
              "px-3 py-1.5 text-xs font-medium rounded-t transition-colors",
              statusFilter === tab.value
                ? "border-b-2 border-[var(--color-accent)] text-[var(--color-accent)]"
                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-[var(--color-text-muted)] pr-2">
          {total} records
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-[var(--color-surface-raised)] border-b border-[var(--color-border)] z-10">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Employee ID
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Type
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Start Date
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                End Date
              </th>
              <th className="px-3 py-2 text-right font-medium text-[var(--color-text-secondary)]">
                Days
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Reason
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Status
              </th>
              <th className="px-3 py-2 text-left font-medium text-[var(--color-text-secondary)]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-[var(--color-text-muted)]">
                  No leave requests found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((lr) => (
                <tr
                  key={lr.id}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-[var(--color-text-secondary)] max-w-[160px] truncate">
                    {lr.employee_id}
                  </td>
                  <td className="px-3 py-2">
                    <Tag tone={leaveTypeTone(lr.leave_type)} size="sm">
                      {lr.leave_type.charAt(0).toUpperCase() + lr.leave_type.slice(1)}
                    </Tag>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(lr.start_date)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDate(lr.end_date)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{lr.days}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate text-[var(--color-text-secondary)]">
                    {lr.reason || "-"}
                  </td>
                  <td className="px-3 py-2">
                    <Tag tone={statusTone(lr.status)} size="sm">
                      {lr.status.charAt(0).toUpperCase() + lr.status.slice(1)}
                    </Tag>
                  </td>
                  <td className="px-3 py-2">
                    {lr.status === "pending" && (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={actionLoading === lr.id + "-approve"}
                          onClick={() => handleApprove(lr.id)}
                        >
                          {actionLoading === lr.id + "-approve" ? "…" : "Approve"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={actionLoading === lr.id + "-reject"}
                          onClick={() => setRejectTarget(lr.id)}
                        >
                          {actionLoading === lr.id + "-reject" ? "…" : "Reject"}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <RequestLeaveDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />

      <RejectDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => {
          if (rejectTarget) handleReject(rejectTarget, reason);
        }}
      />
    </div>
  );
}
