"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { getTrainingRecord, updateTrainingStatus, type TrainingRecord, type TrainingStatus } from "@/lib/api/hr";

export default function TrainingRecordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [record, setRecord] = useState<TrainingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [certNo, setCertNo] = useState("");

  useEffect(() => {
    if (!id) return;
    getTrainingRecord(id).then(r => {
      setRecord(r);
      if (r.certificate_no) setCertNo(r.certificate_no);
    }).finally(() => setLoading(false));
  }, [id]);

  async function changeStatus(status: TrainingStatus) {
    if (!record) return;
    setSaving(true);
    await updateTrainingStatus(record.id, status).catch(() => null);
    setRecord(prev => prev ? { ...prev, status, certificate_no: certNo || prev.certificate_no } : prev);
    setSaving(false);
  }

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!record) return <div className="p-6 text-sm text-red-600">Training record not found</div>;

  const STATUS_COLORS: Record<string, string> = {
    planned: "bg-blue-100 text-blue-700",
    active: "bg-amber-100 text-amber-700",
    completed: "bg-green-100 text-green-700",
    cancelled: "bg-surface-2 text-ink-3",
  };

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Training", href: "/hr/training" }, { label: record.title ?? record.course_name ?? record.id }]} />

      {/* Header */}
      <div className="rounded-lg border border-line bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold">{record.title ?? record.course_name}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[record.status] ?? "bg-surface-2 text-ink-3"}`}>{record.status}</span>
          </div>
          <div className="text-sm text-ink-3 space-y-0.5">
            {record.trainer && <div>Trainer: {record.trainer}</div>}
            {record.location && <div>Location: {record.location}</div>}
            {record.start_date && <div>Start: {record.start_date.slice(0, 10)}</div>}
            {record.end_date && <div>End: {record.end_date.slice(0, 10)}</div>}
            {record.max_participants != null && <div>Max Participants: {record.max_participants}</div>}
            {record.description && <div className="mt-1">{record.description}</div>}
          </div>
        </div>
        <button onClick={() => router.back()} className="text-xs text-ink-3 hover:text-ink border border-line px-3 py-1.5 rounded">← Back</button>
      </div>

      {/* Status actions */}
      <div className="rounded-lg border border-line bg-surface p-5 space-y-3">
        <h3 className="text-sm font-medium">Update Status</h3>
        <div className="flex gap-2 flex-wrap">
          {record.status === "planned" && (
            <button onClick={() => changeStatus("active")} disabled={saving}
              className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              Activate
            </button>
          )}
          {record.status === "active" && (
            <button onClick={() => changeStatus("completed")} disabled={saving}
              className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
              Mark Complete
            </button>
          )}
          {record.status !== "cancelled" && record.status !== "completed" && (
            <button onClick={() => changeStatus("cancelled")} disabled={saving}
              className="px-3 py-1.5 text-xs rounded border border-danger/30 text-danger hover:bg-danger/5 disabled:opacity-50">
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="rounded-lg border border-line bg-surface p-5 grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-ink-3">Trainer:</span> {record.trainer ?? "—"}</div>
        <div><span className="text-ink-3">Location:</span> {record.location ?? "—"}</div>
        <div><span className="text-ink-3">Start:</span> {record.start_date?.slice(0, 10) ?? "—"}</div>
        <div><span className="text-ink-3">End:</span> {record.end_date?.slice(0, 10) ?? "—"}</div>
        <div><span className="text-ink-3">Max Participants:</span> {record.max_participants ?? "—"}</div>
        <div><span className="text-ink-3">Status:</span> {record.status}</div>
        {record.notes && <div className="col-span-2"><span className="text-ink-3">Notes:</span> {record.notes}</div>}
      </div>
    </div>
  );
}
