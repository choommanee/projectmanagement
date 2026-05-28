"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listPayrollRuns,
  createPayrollRun,
  updatePayrollRun,
  deletePayrollRun,
  type PayrollRun,
} from "@/lib/api/hr";

type PayrunStatus = "draft" | "processing" | "completed" | "cancelled";
const STATUS_VALUES: PayrunStatus[] = ["draft", "processing", "completed", "cancelled"];

function statusTone(s: string): "neutral" | "info" | "success" | "danger" {
  if (s === "draft") return "neutral";
  if (s === "processing") return "info";
  if (s === "completed") return "success";
  if (s === "cancelled") return "danger";
  return "neutral";
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 }).format(n);
}

function NewRunDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (run: PayrollRun) => void;
}) {
  const thisMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  const [period, setPeriod] = useState(thisMonth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPeriod(thisMonth);
      setError(null);
    }
  }, [open, thisMonth]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!period) { setError("Period is required"); return; }
    setLoading(true);
    try {
      const run = await createPayrollRun({ period, status: "draft" });
      onCreated(run);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Payroll Run">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[320px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Period (YYYY-MM)</span>
          <Input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026-05"
            required
          />
          <span className="text-xs text-ink-3">Enter year-month, e.g. 2026-05</span>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Start Payroll Run"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditRunDialog({
  run,
  onClose,
  onUpdated,
}: {
  run: PayrollRun | null;
  onClose: () => void;
  onUpdated: (r: PayrollRun) => void;
}) {
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (run) {
      setStatus(run.status);
      setError(null);
    }
  }, [run]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!run) return;
    setLoading(true);
    try {
      const updated = await updatePayrollRun(run.id, { status });
      onUpdated(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={run !== null} onClose={onClose} title="Edit Payroll Run">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[300px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        {run && (
          <div className="text-sm text-ink-2 font-mono border-b border-line pb-2 mb-1">
            Period: {run.period}
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function PayrollRunPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<PayrollRun | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listPayrollRuns().then(setRuns).catch(() => setRuns([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(run: PayrollRun) {
    if (!confirm(`Cancel payroll run for period "${run.period}"? This sets status to cancelled.`)) return;
    setDeleting(run.id);
    setDeleteError(null);
    try {
      await deletePayrollRun(run.id);
      setRuns((prev) => prev.filter((r) => r.id !== run.id));
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "HR", href: "/hr/home" }, { label: "Payroll Run" }]} />
      <CommandBar actions={[{
        id: "new", label: "New Run", icon: "plus", onClick: () => setNewOpen(true),
      }]} />

      {deleteError && (
        <div className="rounded border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          {deleteError}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Employees</th>
                <th className="px-4 py-2 text-right font-medium">Total Net</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Created</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-3">
                    No payroll runs. Click &quot;New Run&quot; to start one.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr
                    key={run.id}
                    className="hover:bg-surface-2/50 cursor-pointer"
                    onClick={() => router.push("/hr/payroll-run/" + run.id)}
                  >
                    <td className="px-4 py-2 font-mono font-medium">{run.period}</td>
                    <td className="px-4 py-2 text-right font-mono">
                      {run.employee_count ?? run.total_employees ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono font-semibold">
                      {fmt(run.total_net ?? run.total_net_pay ?? 0)}
                    </td>
                    <td className="px-4 py-2">
                      <Tag tone={statusTone(run.status)} size="sm">{run.status}</Tag>
                    </td>
                    <td className="px-4 py-2 text-ink-3">
                      {run.created_at ? new Date(run.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setEditing(run)}
                          disabled={run.status === "cancelled"}
                          className="rounded border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 disabled:opacity-40 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(run)}
                          disabled={deleting === run.id || run.status === "cancelled"}
                          className="rounded border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/5 disabled:opacity-40 transition-colors"
                        >
                          {deleting === run.id ? "…" : "Cancel"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <NewRunDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(run) => {
          setRuns((prev) => [run, ...prev]);
          setNewOpen(false);
        }}
      />

      <EditRunDialog
        run={editing}
        onClose={() => setEditing(null)}
        onUpdated={(updated) => {
          setRuns((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
          setEditing(null);
        }}
      />
    </div>
  );
}
