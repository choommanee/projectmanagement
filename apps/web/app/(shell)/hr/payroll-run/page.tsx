"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import { listPayrollRuns, createPayrollRun, type PayrollRun } from "@/lib/api/hr";

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
  open, onClose, onCreated,
}: { open: boolean; onClose: () => void; onCreated: (run: PayrollRun) => void }) {
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = today.slice(0, 8) + "01";
  const [form, setForm] = useState({ period_start: firstOfMonth, period_end: today });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setForm({ period_start: firstOfMonth, period_end: today }); setError(null); }
  }, [open, firstOfMonth, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const run = await createPayrollRun(form);
      onCreated(run);
    } catch (err) {
      setError(String(err));
    } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Payroll Run">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Period Start</span>
          <Input type="date" value={form.period_start} onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Period End</span>
          <Input type="date" value={form.period_end} onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))} required />
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

export default function PayrollRunPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    listPayrollRuns().then(setRuns).catch(() => setRuns([])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "HR", href: "/hr/home" }, { label: "Payroll Run" }]} />
      <CommandBar actions={[{
        id: "new", label: "New Run", icon: "plus", onClick: () => setNewOpen(true),
      }]} />

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-right font-medium">Employees</th>
                <th className="px-4 py-2 text-right font-medium">Total Net Pay</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Created</th>
                <th className="px-4 py-2 text-left font-medium">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {runs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-3">No payroll runs. Click &quot;New Run&quot; to start one.</td></tr>
              ) : runs.map((run) => (
                <tr key={run.id} className="hover:bg-surface-2/50 cursor-pointer" onClick={() => router.push('/hr/payroll-run/' + run.id)}>
                  <td className="px-4 py-2 font-medium">
                    {run.period_start?.slice(0, 10)} → {run.period_end?.slice(0, 10)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{run.total_employees ?? "—"}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{fmt(run.total_net_pay ?? 0)}</td>
                  <td className="px-4 py-2">
                    <Tag tone={statusTone(run.status)} size="sm">{run.status}</Tag>
                  </td>
                  <td className="px-4 py-2 text-ink-3">{new Date(run.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-ink-3">{run.completed_at ? new Date(run.completed_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewRunDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(run) => { setRuns((prev) => [run, ...prev]); setNewOpen(false); }}
      />
    </div>
  );
}
