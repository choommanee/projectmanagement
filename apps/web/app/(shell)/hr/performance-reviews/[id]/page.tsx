"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getPerformanceReview, updatePerformanceReview,
  type PerformanceReview, type ReviewStatus, type ReviewRating,
} from "@/lib/api/hr";

const RATINGS: ReviewRating[] = [1, 2, 3, 4, 5];

export default function PerformanceReviewDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [review, setReview] = useState<PerformanceReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selfComments, setSelfComments] = useState("");
  const [managerComments, setManagerComments] = useState("");
  const [overallRating, setOverallRating] = useState<ReviewRating | null>(null);

  useEffect(() => {
    if (!id) return;
    getPerformanceReview(id)
      .then(r => {
        setReview(r);
        setSelfComments(r.selfComments);
        setManagerComments(r.managerComments);
        setOverallRating(r.overallRating);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  async function handleAdvanceStatus() {
    if (!review) return;
    const next: Record<ReviewStatus, ReviewStatus | null> = {
      draft: "self_review",
      self_review: "manager_review",
      manager_review: "completed",
      completed: null,
    };
    const nextStatus = next[review.status];
    if (!nextStatus) return;
    setSaving(true);
    try {
      const updated = await updatePerformanceReview(review.id, {
        status: nextStatus,
        self_comments: selfComments,
        manager_comments: managerComments,
        overall_rating: overallRating ?? undefined,
      });
      setReview(updated);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!review) return <div className="p-8 text-destructive">Review not found.</div>;

  const statusColors: Record<ReviewStatus, string> = {
    draft: "bg-muted text-ink-3",
    self_review: "bg-blue-100 text-blue-800",
    manager_review: "bg-purple-100 text-purple-800",
    completed: "bg-green-100 text-green-800",
  };

  const nextLabels: Record<ReviewStatus, string | null> = {
    draft: "Start Self Review",
    self_review: "Submit for Manager Review",
    manager_review: "Mark Complete",
    completed: null,
  };

  const ratingLabel = (r: ReviewRating) => ["", "Poor", "Below Avg", "Average", "Good", "Excellent"][r];

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/hr/performance-reviews")} className="hover:underline">Performance Reviews</button>
        <span className="mx-2">/</span>
        <span>{review.employeeName}</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{review.employeeName}</h1>
            <p className="text-sm text-ink-3 mt-1">Review Period: {review.reviewPeriod}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusColors[review.status]}`}>
            {review.status.replace("_", " ")}
          </span>
        </div>
        {nextLabels[review.status] && (
          <div className="mt-4">
            <button onClick={handleAdvanceStatus} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50">
              {nextLabels[review.status]}
            </button>
          </div>
        )}
      </div>

      {/* Overall Rating */}
      <div className="rounded-lg border border-line bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3 mb-4">Overall Rating</h2>
        <div className="flex gap-2">
          {RATINGS.map(r => (
            <button key={r} onClick={() => setOverallRating(r)}
              className={`w-10 h-10 rounded text-sm font-semibold border transition-colors ${overallRating === r ? "bg-primary text-primary-foreground border-primary" : "border-line hover:bg-surface-2"}`}>
              {r}
            </button>
          ))}
          {overallRating && <span className="self-center text-sm text-ink-3">{ratingLabel(overallRating)}</span>}
        </div>
      </div>

      {/* Goals */}
      {review.goals.length > 0 && (
        <div className="rounded-lg border border-line bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3 mb-4">Goals</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-3 text-xs uppercase">
                <th className="py-2 pr-4">Description</th>
                <th className="py-2 pr-4 text-right">Weight</th>
                <th className="py-2 pr-4 text-center">Self</th>
                <th className="py-2 text-center">Manager</th>
              </tr>
            </thead>
            <tbody>
              {review.goals.map(g => (
                <tr key={g.id} className="border-t border-line">
                  <td className="py-2 pr-4">{g.description}</td>
                  <td className="py-2 pr-4 text-right font-mono">{g.weight}%</td>
                  <td className="py-2 pr-4 text-center">{g.selfRating ?? "—"}</td>
                  <td className="py-2 text-center">{g.managerRating ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Comments */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-lg border border-line bg-card p-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-ink-3 block mb-2">Self Comments</label>
          <textarea value={selfComments} onChange={e => setSelfComments(e.target.value)} rows={4}
            className="w-full text-sm bg-surface border border-line rounded px-3 py-2 resize-none" />
        </div>
        <div className="rounded-lg border border-line bg-card p-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-ink-3 block mb-2">Manager Comments</label>
          <textarea value={managerComments} onChange={e => setManagerComments(e.target.value)} rows={4}
            className="w-full text-sm bg-surface border border-line rounded px-3 py-2 resize-none" />
        </div>
      </div>
    </div>
  );
}
