"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listTrainingRecords,
  createTrainingRecord,
  listEmployees,
  type TrainingRecord,
  type Employee,
} from "@/lib/api/hr";

const STATUS_OPTS = [
  { value: "", label: "All" },
  { value: "enrolled", label: "Enrolled" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "expired", label: "Expired" },
];

function statusTone(s: string): "neutral" | "info" | "success" | "danger" | "warning" {
  if (s === "enrolled") return "neutral";
  if (s === "in_progress") return "info";
  if (s === "completed") return "success";
  if (s === "expired") return "danger";
  return "neutral";
}

function empDisplayName(emp: Employee): string {
  return `${emp.firstName} ${emp.lastName}`.trim() || emp.empNo || emp.id;
}

function NewTrainingDialog({
  open,
  employees,
  onClose,
  onCreated,
}: {
  open: boolean;
  employees: Employee[];
  onClose: () => void;
  onCreated: (r: TrainingRecord) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    employee_id: "",
    course_name: "",
    provider: "",
    started_at: today,
    expiry_date: "",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({
        employee_id: employees[0]?.id ?? "",
        course_name: "",
        provider: "",
        started_at: today,
        expiry_date: "",
        notes: "",
      });
      setError(null);
    }
  }, [open, employees, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.employee_id || !form.course_name) {
      setError("Employee and course name required");
      return;
    }
    setLoading(true);
    try {
      const rec = await createTrainingRecord({
        employee_id: form.employee_id,
        course_name: form.course_name,
        provider: form.provider || undefined,
        started_at: form.started_at || undefined,
        expiry_date: form.expiry_date || undefined,
        notes: form.notes || undefined,
        status: "enrolled",
      });
      onCreated(rec);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Training Record">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[360px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Employee *</span>
          <select
            value={form.employee_id}
            onChange={(e) => setForm((f) => ({ ...f, employee_id: e.target.value }))}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {empDisplayName(emp)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Course Name *</span>
          <Input
            value={form.course_name}
            onChange={(e) => setForm((f) => ({ ...f, course_name: e.target.value }))}
            placeholder="ISO 9001 Internal Auditor…"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Provider</span>
          <Input
            value={form.provider}
            onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
            placeholder="TÜV, SGS, internal…"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Start Date</span>
          <Input
            type="date"
            value={form.started_at}
            onChange={(e) => setForm((f) => ({ ...f, started_at: e.target.value }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Expiry Date</span>
          <Input
            type="date"
            value={form.expiry_date}
            onChange={(e) => setForm((f) => ({ ...f, expiry_date: e.target.value }))}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Saving…" : "Add Record"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function HRTrainingPage() {
  const router = useRouter();
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      listTrainingRecords(statusFilter ? { status: statusFilter } : undefined),
      listEmployees(),
    ])
      .then(([rr, er]) => {
        setRecords(rr.status === "fulfilled" ? rr.value : []);
        setEmployees(er.status === "fulfilled" ? er.value.items : []);
      })
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const expiringSoon = records.filter((r) => {
    if (!r.expiry_date) return false;
    const days = (new Date(r.expiry_date).getTime() - Date.now()) / 86400000;
    return days >= 0 && days <= 30;
  }).length;

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "HR", href: "/hr/home" }, { label: "Training Records" }]} />
      <CommandBar
        actions={[{ id: "new", label: "+ Add Record", variant: "primary" as const, onClick: () => setNewOpen(true) }]}
      />

      {expiringSoon > 0 && (
        <div className="rounded border border-warning/30 bg-warning/5 px-4 py-2 text-sm text-warning">
          ⚠ {expiringSoon} certification{expiringSoon > 1 ? "s" : ""} expiring within 30 days
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {STATUS_OPTS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setStatusFilter(opt.value)}
            className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
              statusFilter === opt.value
                ? "bg-accent text-white"
                : "bg-surface-2 text-ink hover:bg-surface-2"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Employee</th>
                <th className="px-4 py-2 text-left font-medium">Course</th>
                <th className="px-4 py-2 text-left font-medium">Provider</th>
                <th className="px-4 py-2 text-left font-medium">Started</th>
                <th className="px-4 py-2 text-left font-medium">Expires</th>
                <th className="px-4 py-2 text-left font-medium">Cert #</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-ink-3">
                    No training records found.
                  </td>
                </tr>
              ) : (
                records.map((rec) => {
                  const expiring =
                    rec.expiry_date &&
                    (new Date(rec.expiry_date).getTime() - Date.now()) / 86400000 <= 30 &&
                    (new Date(rec.expiry_date).getTime() - Date.now()) / 86400000 >= 0;
                  return (
                    <tr
                      key={rec.id}
                      onClick={() => router.push('/hr/training/' + rec.id)}
                      className={`hover:bg-surface-2/50 cursor-pointer ${expiring ? "bg-warning/5" : ""}`}
                    >
                      <td className="px-4 py-2 font-medium">
                        {rec.employee_name ?? rec.employee_id}
                      </td>
                      <td className="px-4 py-2">{rec.course_name}</td>
                      <td className="px-4 py-2 text-ink-3">{rec.provider ?? "—"}</td>
                      <td className="px-4 py-2 text-ink-3">
                        {rec.started_at ? new Date(rec.started_at).toLocaleDateString() : "—"}
                      </td>
                      <td
                        className={`px-4 py-2 ${
                          expiring ? "text-warning font-semibold" : "text-ink-3"
                        }`}
                      >
                        {rec.expiry_date ? new Date(rec.expiry_date).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-ink-3">
                        {rec.certificate_no ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        <Tag tone={statusTone(rec.status)} size="sm">
                          {rec.status}
                        </Tag>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <NewTrainingDialog
        open={newOpen}
        employees={employees}
        onClose={() => setNewOpen(false)}
        onCreated={(rec) => {
          setRecords((p) => [rec, ...p]);
          setNewOpen(false);
        }}
      />
    </div>
  );
}
