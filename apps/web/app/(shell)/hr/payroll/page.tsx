"use client";

import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar, type CommandAction } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listPayslips,
  createPayslip,
  approvePayslip,
  markPayslipPaid,
  type Payslip,
  type PayslipStatus,
} from "@/lib/api/hr";

const STATUS_TABS: { value: PayslipStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
];

function statusTone(
  s: PayslipStatus
): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "draft") return "neutral";
  if (s === "approved") return "info";
  if (s === "paid") return "success";
  return "neutral";
}

function fmt(n: number, currency = "THB"): string {
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d: string): string {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

type FormData = {
  employee_id: string;
  period_start: string;
  period_end: string;
  base_salary: string;
  allowances: string;
  deductions: string;
  currency: string;
};

const TODAY = new Date().toISOString().split("T")[0];
const FIRST_OF_MONTH = TODAY.slice(0, 8) + "01";

const EMPTY_FORM: FormData = {
  employee_id: "",
  period_start: FIRST_OF_MONTH,
  period_end: TODAY,
  base_salary: "",
  allowances: "0",
  deductions: "0",
  currency: "THB",
};

function CreatePayslipDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (ps: Payslip) => void;
}) {
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setError(null);
    }
  }, [open]);

  const set = (k: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.employee_id.trim()) {
      setError("Employee ID is required");
      return;
    }
    if (!form.period_start || !form.period_end) {
      setError("Period start and end are required");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ps = await createPayslip({
        employee_id: form.employee_id.trim(),
        period_start: form.period_start,
        period_end: form.period_end,
        base_salary: parseFloat(form.base_salary) || 0,
        allowances: parseFloat(form.allowances) || 0,
        deductions: parseFloat(form.deductions) || 0,
        currency: form.currency || "THB",
      });
      onSaved(ps);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create payslip");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create Payslip">
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

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Period Start
            </label>
            <Input type="date" value={form.period_start} onChange={set("period_start")} required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Period End
            </label>
            <Input type="date" value={form.period_end} onChange={set("period_end")} required />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            Base Salary
          </label>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="0.00"
            value={form.base_salary}
            onChange={set("base_salary")}
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Allowances
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.allowances}
              onChange={set("allowances")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Deductions
            </label>
            <Input
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.deductions}
              onChange={set("deductions")}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">
            Currency
          </label>
          <Input placeholder="THB" value={form.currency} onChange={set("currency")} />
        </div>

        {/* Net pay preview */}
        <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-[var(--color-text-secondary)]">Net Pay (preview)</span>
          <span className="font-mono tabular-nums text-sm font-semibold">
            {fmt(
              (parseFloat(form.base_salary) || 0) +
                (parseFloat(form.allowances) || 0) -
                (parseFloat(form.deductions) || 0),
              form.currency || "THB"
            )}
          </span>
        </div>

        {error && (
          <p className="text-xs text-[var(--color-danger)]">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" type="button" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create Payslip"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function PayrollPage() {
  const [items, setItems] = useState<Payslip[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<PayslipStatus | "">("");
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const commands: CommandAction[] = [
    { id: "create-payslip", label: "+ Create Payslip", variant: "primary", onClick: () => setDialogOpen(true) },
  ];

  const load = useCallback(
    async (status: PayslipStatus | "") => {
      setLoading(true);
      try {
        const res = await listPayslips(status ? { status } : {});
        setItems(res.items);
        setTotal(res.total);
      } catch {
        // silently degrade — table shows empty state
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(statusFilter);
  }, [load, statusFilter]);

  function handleSaved(ps: Payslip) {
    setDialogOpen(false);
    setItems((prev) => [ps, ...prev]);
    setTotal((t) => t + 1);
  }

  async function handleApprove(id: string) {
    setActionLoading(id + "-approve");
    try {
      const updated = await approvePayslip(id);
      setItems((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch {
      // no-op; re-load on next interaction
    } finally {
      setActionLoading(null);
    }
  }

  async function handleMarkPaid(id: string) {
    setActionLoading(id + "-paid");
    try {
      const updated = await markPayslipPaid(id);
      setItems((prev) => prev.map((p) => (p.id === id ? updated : p)));
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
          { label: "Payroll" },
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
                Period
              </th>
              <th className="px-3 py-2 text-right font-medium text-[var(--color-text-secondary)]">
                Base Salary
              </th>
              <th className="px-3 py-2 text-right font-medium text-[var(--color-text-secondary)]">
                Allowances
              </th>
              <th className="px-3 py-2 text-right font-medium text-[var(--color-text-secondary)]">
                Deductions
              </th>
              <th className="px-3 py-2 text-right font-medium text-[var(--color-text-secondary)]">
                Net Pay
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
                  No payslips found.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((ps) => (
                <tr
                  key={ps.id}
                  className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-[var(--color-text-secondary)] max-w-[160px] truncate">
                    {ps.employee_id}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fmtDate(ps.period_start)} – {fmtDate(ps.period_end)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmt(ps.base_salary, ps.currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-success)]">
                    +{fmt(ps.allowances, ps.currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--color-danger)]">
                    -{fmt(ps.deductions, ps.currency)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums font-semibold">
                    {fmt(ps.net_pay, ps.currency)}
                  </td>
                  <td className="px-3 py-2">
                    <Tag tone={statusTone(ps.status)} size="sm">
                      {ps.status.charAt(0).toUpperCase() + ps.status.slice(1)}
                    </Tag>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      {ps.status === "draft" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={actionLoading === ps.id + "-approve"}
                          onClick={() => handleApprove(ps.id)}
                        >
                          {actionLoading === ps.id + "-approve" ? "…" : "Approve"}
                        </Button>
                      )}
                      {ps.status === "approved" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={actionLoading === ps.id + "-paid"}
                          onClick={() => handleMarkPaid(ps.id)}
                        >
                          {actionLoading === ps.id + "-paid" ? "…" : "Mark Paid"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <CreatePayslipDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={handleSaved}
      />
    </div>
  );
}
