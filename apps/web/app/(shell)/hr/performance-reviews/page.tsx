"use client";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listPerformanceReviews, createPerformanceReview, updatePerformanceReview,
  listEmployees,
  type PerformanceReview, type ReviewStatus, type Employee,
} from "@/lib/api/hr";

const STATUS_LABELS: Record<ReviewStatus, string> = {
  draft: "Draft",
  self_review: "Self Review",
  manager_review: "Manager Review",
  completed: "Completed",
};

const STATUS_COLORS: Record<ReviewStatus, string> = {
  draft: "bg-zinc-100 text-zinc-600",
  self_review: "bg-blue-100 text-blue-700",
  manager_review: "bg-amber-100 text-amber-700",
  completed: "bg-green-100 text-green-700",
};

export default function PerformanceReviewsPage() {
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [filter, setFilter] = useState<ReviewStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newEmpId, setNewEmpId] = useState("");
  const [newPeriod, setNewPeriod] = useState("2026-H1");
  const [selected, setSelected] = useState<PerformanceReview | null>(null);

  useEffect(() => {
    Promise.all([
      listPerformanceReviews().then(r => setReviews(r.items)),
      listEmployees().then(r => setEmployees(r.items)),
    ]).finally(() => setLoading(false));
  }, []);

  const filtered = filter === "all" ? reviews : reviews.filter(r => r.status === filter);

  async function handleCreate() {
    if (!newEmpId || !newPeriod) return;
    const rev = await createPerformanceReview({ employee_id: newEmpId, review_period: newPeriod });
    setReviews(prev => [rev, ...prev]);
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
    setReviews(prev => prev.map(r => r.id === updated.id ? updated : r));
    if (selected?.id === updated.id) setSelected(updated);
  }

  const ratingStars = (n: number | null) =>
    n == null ? <span className="text-muted-foreground text-xs">—</span> :
      <span className="text-amber-500">{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Performance Reviews" }]} />

      <div className="grid grid-cols-4 gap-4">
        {(["draft", "self_review", "manager_review", "completed"] as ReviewStatus[]).map(s => (
          <div key={s} className="rounded-lg border border-border bg-surface p-4">
            <div className="text-xs text-muted-foreground mb-1">{STATUS_LABELS[s]}</div>
            <div className="text-2xl font-mono font-semibold">
              {reviews.filter(r => r.status === s).length}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-1">
          {(["all", "draft", "self_review", "manager_review", "completed"] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${filter === s ? "bg-accent text-white border-accent" : "border-border text-muted-foreground hover:bg-muted"}`}
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
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <h3 className="text-sm font-medium">Start Performance Review</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Employee</label>
              <select
                value={newEmpId}
                onChange={e => setNewEmpId(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              >
                <option value="">Select employee…</option>
                {employees.filter(e => e.status === "active").map(e => (
                  <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Review Period</label>
              <input
                value={newPeriod}
                onChange={e => setNewPeriod(e.target.value)}
                placeholder="e.g. 2026-H1"
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90">Create</button>
            <button onClick={() => setShowNew(false)} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground uppercase">
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
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No reviews found</td></tr>
              )}
              {filtered.map(rev => (
                <tr key={rev.id} className="border-t border-border hover:bg-muted/30 cursor-pointer" onClick={() => setSelected(rev)}>
                  <td className="px-4 py-3 font-medium">{rev.employeeName}</td>
                  <td className="px-4 py-3 font-mono text-xs">{rev.reviewPeriod}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[rev.status]}`}>
                      {STATUS_LABELS[rev.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">{ratingStars(rev.overallRating)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{rev.goals.length} goals</td>
                  <td className="px-4 py-3 text-right">
                    {rev.status !== "completed" && (
                      <button
                        onClick={e => { e.stopPropagation(); advanceStatus(rev); }}
                        className="px-2 py-1 text-xs rounded border border-border hover:bg-muted"
                      >
                        Advance →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="fixed inset-y-0 right-0 w-96 bg-surface border-l border-border shadow-xl p-6 overflow-y-auto z-50">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{selected.employeeName}</h2>
            <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground text-lg">×</button>
          </div>
          <div className="space-y-3 text-sm">
            <div><span className="text-muted-foreground">Period:</span> {selected.reviewPeriod}</div>
            <div><span className="text-muted-foreground">Status:</span>{" "}
              <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[selected.status]}`}>{STATUS_LABELS[selected.status]}</span>
            </div>
            <div><span className="text-muted-foreground">Overall:</span> {ratingStars(selected.overallRating)}</div>
            {selected.selfComments && (
              <div>
                <div className="text-muted-foreground mb-1">Self Comments</div>
                <p className="text-xs bg-muted rounded p-2">{selected.selfComments}</p>
              </div>
            )}
            {selected.managerComments && (
              <div>
                <div className="text-muted-foreground mb-1">Manager Comments</div>
                <p className="text-xs bg-muted rounded p-2">{selected.managerComments}</p>
              </div>
            )}
            {selected.goals.length > 0 && (
              <div>
                <div className="text-muted-foreground mb-2">Goals</div>
                <div className="space-y-2">
                  {selected.goals.map(goal => (
                    <div key={goal.id} className="border border-border rounded p-2">
                      <div className="text-xs">{goal.description}</div>
                      <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                        <span>Weight: {goal.weight}%</span>
                        <span>Self: {ratingStars(goal.selfRating)}</span>
                        <span>Mgr: {ratingStars(goal.managerRating)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
