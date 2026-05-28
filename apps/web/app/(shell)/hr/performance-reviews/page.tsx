"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listPerformanceReviews, createPerformanceReview, updatePerformanceReview, deletePerformanceReview,
  listEmployees,
  type PerformanceReview, type ReviewStatus, type Employee,
} from "@/lib/api/hr";

const STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Draft",
  self_review: "Self Review",
  manager_review: "Manager Review",
  completed: "Completed",
};

const STATUS_TONES: Record<ReviewStatus, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral",
  self_review: "info",
  manager_review: "warning",
  completed: "success",
};

const ALL_STATUSES: ReviewStatus[] = ["draft", "self_review", "manager_review", "completed"];

function EditReviewDialog({
  review,
  onClose,
  onUpdated,
}: {
  review: PerformanceReview | null;
  onClose: () => void;
  onUpdated: (r: PerformanceReview) => void;
}) {
  const [status, setStatus] = useState<ReviewStatus>("draft");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (review) {
      setStatus(review.status);
      setError(null);
    }
  }, [review]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!review) return;
    setLoading(true);
    try {
      const updated = await updatePerformanceReview(review.id, { status });
      onUpdated(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={review !== null} onClose={onClose} title="Edit Performance Review">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[320px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        {review && (
          <div className="border-b border-line pb-2 mb-1">
            <p className="text-sm font-medium">{review.employeeName}</p>
            <p className="text-xs text-ink-3 font-mono">{review.reviewPeriod}</p>
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ReviewStatus)}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
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

export default function PerformanceReviewsPage() {
  const router = useRouter();
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<ReviewStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newEmpId, setNewEmpId] = useState("");
  const [newPeriod, setNewPeriod] = useState("2026-H1");
  const [editing, setEditing] = useState<PerformanceReview | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      listPerformanceReviews().then((r) => setReviews(r.items)),
      listEmployees().then((r) => setEmployees(r.items)),
    ]).finally(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? reviews : reviews.filter((r) => r.status === filter);

  async function handleCreate() {
    if (!newEmpId || !newPeriod) return;
    const rev = await createPerformanceReview({ employee_id: newEmpId, review_period: newPeriod });
    setReviews((prev) => [rev, ...prev]);
    setShowNew(false);
    setNewEmpId("");
  }

  async function advanceStatus(rev: PerformanceReview) {
    const next: Record<ReviewStatus, ReviewStatus | null> = {
      draft: "self_review",
      self_review: "manager_review",
      manager_review: "completed",
      completed: null,
    };
    const nextStatus = next[rev.status];
    if (!nextStatus) return;
    const updated = await updatePerformanceReview(rev.id, { status: nextStatus });
    setReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  async function handleDelete(rev: PerformanceReview) {
    if (!confirm(`Remove review for "${rev.employeeName}" (${rev.reviewPeriod})?`)) return;
    setDeleting(rev.id);
    setDeleteError(null);
    try {
      await deletePerformanceReview(rev.id);
      setReviews((prev) => prev.filter((r) => r.id !== rev.id));
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeleting(null);
    }
  }

  const ratingStars = (n: number | null) =>
    n == null ? (
      <span className="text-ink-3 text-xs">—</span>
    ) : (
      <span className="text-amber-500">{"★".repeat(n)}{"☆".repeat(5 - n)}</span>
    );

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Performance Reviews" }]} />

      <div className="grid grid-cols-4 gap-4">
        {ALL_STATUSES.map((s) => (
          <div key={s} className="rounded-lg border border-line bg-surface p-4">
            <div className="text-xs text-ink-3 mb-1">{STATUS_LABELS[s]}</div>
            <div className="text-2xl font-mono font-semibold">
              {reviews.filter((r) => r.status === s).length}
            </div>
          </div>
        ))}
      </div>

      {deleteError && (
        <div className="rounded border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          {deleteError}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1">
          {(["all", ...ALL_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                filter === s
                  ? "bg-accent text-white border-accent"
                  : "border-line text-ink-3 hover:bg-surface-2"
              }`}
            >
              {s === "all" ? "All" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/90"
        >
          + New Review
        </button>
      </div>

      {showNew && (
        <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
          <h3 className="text-sm font-medium">Start Performance Review</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-ink-3 block mb-1">Employee</label>
              <select
                value={newEmpId}
                onChange={(e) => setNewEmpId(e.target.value)}
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface"
              >
                <option value="">Select employee…</option>
                {employees.filter((e) => e.status === "active").map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-ink-3 block mb-1">Review Period</label>
              <input
                value={newPeriod}
                onChange={(e) => setNewPeriod(e.target.value)}
                placeholder="e.g. 2026-H1"
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90"
            >
              Create
            </button>
            <button
              onClick={() => setShowNew(false)}
              className="px-3 py-1.5 text-xs rounded border border-line hover:bg-surface-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-ink-3">Loading…</div>
      ) : (
        <div className="rounded-lg border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-ink-3 uppercase">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Employee</th>
                <th className="px-4 py-2 text-left font-medium">Period</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-left font-medium">Overall Rating</th>
                <th className="px-4 py-2 text-left font-medium">Goals</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-ink-3">
                    No reviews found
                  </td>
                </tr>
              )}
              {filtered.map((rev) => (
                <tr
                  key={rev.id}
                  className="border-t border-line hover:bg-surface-2 cursor-pointer"
                  onClick={() => router.push("/hr/performance-reviews/" + rev.id)}
                >
                  <td className="px-4 py-3 font-medium">{rev.employeeName}</td>
                  <td className="px-4 py-3 font-mono text-xs">{rev.reviewPeriod}</td>
                  <td className="px-4 py-3">
                    <Tag tone={STATUS_TONES[rev.status]} size="sm">
                      {STATUS_LABELS[rev.status]}
                    </Tag>
                  </td>
                  <td className="px-4 py-3">{ratingStars(rev.overallRating)}</td>
                  <td className="px-4 py-3 text-ink-3 text-xs">{rev.goals.length} goals</td>
                  <td className="px-4 py-3 text-right">
                    <div
                      className="flex justify-end gap-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => advanceStatus(rev)}
                        disabled={rev.status === "completed"}
                        className="px-2 py-1 text-xs rounded border border-line hover:bg-surface-2 disabled:opacity-40 transition-colors"
                      >
                        Advance
                      </button>
                      <button
                        onClick={() => setEditing(rev)}
                        className="rounded border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(rev)}
                        disabled={deleting === rev.id}
                        className="rounded border border-danger/30 px-2 py-1 text-xs text-danger hover:bg-danger/5 disabled:opacity-40 transition-colors"
                      >
                        {deleting === rev.id ? "…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <EditReviewDialog
        review={editing}
        onClose={() => setEditing(null)}
        onUpdated={(updated) => {
          setReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
          setEditing(null);
        }}
      />
    </div>
  );
}
