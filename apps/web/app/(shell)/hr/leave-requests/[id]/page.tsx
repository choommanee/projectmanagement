"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getLeaveRequest, approveLeaveRequest, rejectLeaveRequest,
  type LeaveRequest,
} from "@/lib/api/hr";

export default function LeaveRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [lr, setLr] = useState<LeaveRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  useEffect(() => {
    if (!id) return;
    getLeaveRequest(id)
      .then(setLr)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleApprove() {
    if (!lr) return;
    setSaving(true);
    try {
      const updated = await approveLeaveRequest(lr.id);
      setLr(updated);
    } finally {
      setSaving(false);
    }
  }

  async function handleReject() {
    if (!lr || !rejectReason.trim()) return;
    setSaving(true);
    try {
      const updated = await rejectLeaveRequest(lr.id, rejectReason);
      setLr(updated);
      setShowReject(false);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!lr) return <div className="p-8 text-destructive">Leave request not found.</div>;

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800",
    approved: "bg-green-100 text-green-800",
    rejected: "bg-red-100 text-red-800",
    cancelled: "bg-gray-200 text-gray-500",
  };

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/hr/leave-requests")} className="hover:underline">Leave Requests</button>
        <span className="mx-2">/</span>
        <span>{lr.id.slice(0, 8)}…</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold capitalize">{lr.leave_type.replace("_", " ")} Leave</h1>
            <p className="text-sm text-ink-3 mt-1">{lr.start_date} → {lr.end_date} · {lr.days} day{lr.days !== 1 ? "s" : ""}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusColors[lr.status] ?? "bg-muted text-ink-3"}`}>
            {lr.status}
          </span>
        </div>
        {lr.status === "pending" && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={handleApprove} disabled={saving}
              className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
              Approve
            </button>
            <button onClick={() => setShowReject(v => !v)} disabled={saving}
              className="px-4 py-1.5 text-sm border border-destructive text-destructive rounded hover:bg-destructive/10 disabled:opacity-50">
              Reject
            </button>
          </div>
        )}
        {showReject && (
          <div className="mt-4 flex gap-2">
            <input
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Rejection reason…"
              className="flex-1 px-3 py-1.5 text-sm border border-line rounded bg-surface"
            />
            <button onClick={handleReject} disabled={saving || !rejectReason.trim()}
              className="px-4 py-1.5 text-sm bg-destructive text-destructive-foreground rounded hover:bg-destructive/90 disabled:opacity-50">
              Confirm Reject
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: "Leave Type", value: lr.leave_type.replace("_", " ") },
          { label: "Days", value: String(lr.days) },
          { label: "Start Date", value: lr.start_date },
          { label: "End Date", value: lr.end_date },
          { label: "Status", value: lr.status },
          { label: "Approved By", value: lr.approved_by ?? "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-line bg-card p-4">
            <p className="text-xs text-ink-3 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-medium capitalize">{value}</p>
          </div>
        ))}
      </div>

      {lr.reason && (
        <div className="rounded-lg border border-line bg-card p-4">
          <p className="text-xs text-ink-3 uppercase tracking-wide mb-2">Reason</p>
          <p className="text-sm">{lr.reason}</p>
        </div>
      )}
      {lr.rejected_reason && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-2">Rejection Reason</p>
          <p className="text-sm">{lr.rejected_reason}</p>
        </div>
      )}
    </div>
  );
}
