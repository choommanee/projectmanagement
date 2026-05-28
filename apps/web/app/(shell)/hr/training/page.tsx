"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listTrainingRecords,
  createTrainingRecord,
  updateTrainingRecord,
  deleteTrainingRecord,
  type TrainingRecord,
} from "@/lib/api/hr";

const STATUS_OPTS = [
  { value: "", label: "All" },
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const STATUS_VALUES = ["planned", "active", "completed", "cancelled"] as const;

function statusTone(s: string): "neutral" | "info" | "success" | "danger" | "warning" {
  if (s === "planned") return "neutral";
  if (s === "active") return "info";
  if (s === "completed") return "success";
  if (s === "cancelled") return "danger";
  return "neutral";
}

function NewTrainingDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (r: TrainingRecord) => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    title: "",
    trainer: "",
    location: "",
    start_date: today,
    end_date: "",
    max_participants: "20",
    status: "planned",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ title: "", trainer: "", location: "", start_date: today, end_date: "", max_participants: "20", status: "planned" });
      setError(null);
    }
  }, [open, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title) { setError("Title is required"); return; }
    setLoading(true);
    try {
      const rec = await createTrainingRecord({
        title: form.title,
        trainer: form.trainer || undefined,
        location: form.location || undefined,
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
        max_participants: form.max_participants ? parseInt(form.max_participants) : undefined,
        status: form.status,
      });
      onCreated(rec);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Training Session">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[380px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Title *</span>
          <Input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="ISO 9001 Internal Auditor…"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Trainer</span>
          <Input
            value={form.trainer}
            onChange={(e) => setForm((f) => ({ ...f, trainer: e.target.value }))}
            placeholder="John Smith"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Location</span>
          <Input
            value={form.location}
            onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            placeholder="Bangkok / Online"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Start Date</span>
            <Input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">End Date</span>
            <Input
              type="date"
              value={form.end_date}
              onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Max Participants</span>
            <Input
              type="number"
              value={form.max_participants}
              onChange={(e) => setForm((f) => ({ ...f, max_participants: e.target.value }))}
              min="1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {STATUS_VALUES.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Saving…" : "Create Session"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditTrainingDialog({
  record,
  onClose,
  onUpdated,
}: {
  record: TrainingRecord | null;
  onClose: () => void;
  onUpdated: (r: TrainingRecord) => void;
}) {
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (record) {
      setStatus(record.status);
      setError(null);
    }
  }, [record]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!record) return;
    setLoading(true);
    try {
      const updated = await updateTrainingRecord(record.id, { status });
      onUpdated(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={record !== null} onClose={onClose} title="Edit Training Session">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[320px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        {record && (
          <div className="text-sm text-ink-2 font-medium border-b border-line pb-2 mb-1">{record.title}</div>
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

export default function HRTrainingPage() {
  const router = useRouter();
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingRecord | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    listTrainingRecords(statusFilter ? { status: statusFilter } : undefined)
      .then(setRecords)
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(rec: TrainingRecord) {
    if (!confirm(`Cancel "${rec.title}"? This cannot be undone.`)) return;
    setDeleting(rec.id);
    setDeleteError(null);
    try {
      await deleteTrainingRecord(rec.id);
      setRecords((prev) => prev.filter((r) => r.id !== rec.id));
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "HR", href: "/hr/home" }, { label: "Training Sessions" }]} />
      <CommandBar
        actions={[{ id: "new", label: "+ New Session", variant: "primary" as const, onClick: () => setNewOpen(true) }]}
      />

      {deleteError && (
        <div className="rounded border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          {deleteError}
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
                <th className="px-4 py-2 text-left font-medium">Title</th>
                <th className="px-4 py-2 text-left font-medium">Trainer</th>
                <th className="px-4 py-2 text-left font-medium">Location</th>
                <th className="px-4 py-2 text-left font-medium">Start</th>
                <th className="px-4 py-2 text-left font-medium">End</th>
                <th className="px-4 py-2 text-right font-medium">Max</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-ink-3">
                    No training sessions found.
                  </td>
                </tr>
              ) : (
                records.map((rec) => (
                  <tr
                    key={rec.id}
                    className="hover:bg-surface-2/50 cursor-pointer"
                    onClick={() => router.push("/hr/training/" + rec.id)}
                  >
                    <td className="px-4 py-2 font-medium">{rec.title}</td>
                    <td className="px-4 py-2 text-ink-3">{rec.trainer ?? "—"}</td>
                    <td className="px-4 py-2 text-ink-3">{rec.location ?? "—"}</td>
                    <td className="px-4 py-2 text-ink-3">
                      {rec.start_date ? new Date(rec.start_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-ink-3">
                      {rec.end_date ? new Date(rec.end_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-ink-3">
                      {rec.max_participants ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Tag tone={statusTone(rec.status)} size="sm">{rec.status}</Tag>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => setEditing(rec)}
                          className="rounded border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(rec)}
                          disabled={deleting === rec.id || rec.status === "cancelled"}
                          className="rounded border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/5 disabled:opacity-40 transition-colors"
                        >
                          {deleting === rec.id ? "…" : "Cancel"}
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

      <NewTrainingDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(rec) => {
          setRecords((p) => [rec, ...p]);
          setNewOpen(false);
        }}
      />

      <EditTrainingDialog
        record={editing}
        onClose={() => setEditing(null)}
        onUpdated={(updated) => {
          setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
          setEditing(null);
        }}
      />
    </div>
  );
}
