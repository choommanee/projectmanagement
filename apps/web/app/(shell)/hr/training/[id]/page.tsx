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
    await updateTrainingStatus(record.id, status, certNo || undefined).catch(() => null);
    setRecord(prev => prev ? { ...prev, status, certificate_no: certNo || prev.certificate_no } : prev);
    setSaving(false);
  }

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!record) return <div className="p-6 text-sm text-red-600">Training record not found</div>;

  const isExpired = record.expiry_date && new Date(record.expiry_date) < new Date();

  const STATUS_COLORS: Record<string, string> = {
    enrolled: "bg-blue-100 text-blue-700",
    in_progress: "bg-amber-100 text-amber-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-600",
    cancelled: "bg-surface-2 text-ink-3",
    expired: "bg-red-100 text-red-600",
  };

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Training", href: "/hr/training" }, { label: record.course_name }]} />

      {/* Header */}
      <div className="rounded-lg border border-line bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold">{record.course_name}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[record.status] ?? "bg-surface-2 text-ink-3"}`}>{record.status}</span>
            {isExpired && <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-600">Expired</span>}
          </div>
          <div className="text-sm text-ink-3 space-y-0.5">
            {record.employee_name && <div className="font-medium text-foreground">{record.employee_name}</div>}
            {record.provider && <div>Provider: {record.provider}</div>}
            {record.started_at && <div>Started: {record.started_at.slice(0, 10)}</div>}
            {record.completed_at && <div>Completed: {record.completed_at.slice(0, 10)}</div>}
            {record.expiry_date && <div className={isExpired ? "text-red-600" : ""}>Expires: {record.expiry_date.slice(0, 10)}</div>}
          </div>
        </div>
        <button onClick={() => router.back()} className="text-xs text-ink-3 hover:text-ink border border-line px-3 py-1.5 rounded">← Back</button>
      </div>

      {/* Certificate & actions */}
      <div className="rounded-lg border border-line bg-surface p-5 space-y-4">
        <h3 className="text-sm font-medium">Completion</h3>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-ink-3">Certificate No.</label>
            <input value={certNo} onChange={e => setCertNo(e.target.value)} placeholder="e.g. CERT-2024-001"
              className="w-full mt-0.5 text-sm border border-line rounded px-2 py-1.5 bg-surface" />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {record.status === "enrolled" && (
            <button onClick={() => changeStatus("in_progress" as TrainingStatus)} disabled={saving}
              className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              Start Training
            </button>
          )}
          {(record.status === "enrolled" || record.status === "in_progress") && (
            <>
              <button onClick={() => changeStatus("completed" as TrainingStatus)} disabled={saving}
                className="px-3 py-1.5 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                Mark Complete
              </button>
              <button onClick={() => changeStatus("failed" as TrainingStatus)} disabled={saving}
                className="px-3 py-1.5 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50">
                Mark Failed
              </button>
            </>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="rounded-lg border border-line bg-surface p-5 grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-ink-3">Employee:</span> {record.employee_name ?? record.employee_id}</div>
        <div><span className="text-ink-3">Provider:</span> {record.provider ?? "—"}</div>
        <div><span className="text-ink-3">Started:</span> {record.started_at?.slice(0, 10) ?? "—"}</div>
        <div><span className="text-ink-3">Completed:</span> {record.completed_at?.slice(0, 10) ?? "—"}</div>
        <div><span className="text-ink-3">Certificate:</span> {record.certificate_no ?? "—"}</div>
        <div><span className="text-ink-3">Expires:</span> <span className={isExpired ? "text-red-600 font-medium" : ""}>{record.expiry_date?.slice(0, 10) ?? "—"}</span></div>
        {record.notes && <div className="col-span-2"><span className="text-ink-3">Notes:</span> {record.notes}</div>}
      </div>
    </div>
  );
}
