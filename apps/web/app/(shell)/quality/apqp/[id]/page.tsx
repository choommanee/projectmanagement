"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getApqp, updateApqp, type ApqpProject, type ApqpPhase, type ApqpStatus } from "@/lib/api/quality";

const PHASES: ApqpPhase[] = ["concept", "design", "process", "validation", "production", "feedback"];

export default function ApqpDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [proj, setProj] = useState<ApqpProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    getApqp(id).then(setProj).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  async function advancePhase() {
    if (!proj) return;
    const idx = PHASES.indexOf(proj.phase);
    if (idx >= PHASES.length - 1) return;
    setSaving(true);
    try {
      const updated = await updateApqp(proj.id, { phase: PHASES[idx + 1], version: proj.version });
      setProj(updated);
    } finally { setSaving(false); }
  }

  async function setStatus(status: ApqpStatus) {
    if (!proj) return;
    setSaving(true);
    try {
      const updated = await updateApqp(proj.id, { status, version: proj.version });
      setProj(updated);
    } finally { setSaving(false); }
  }

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!proj) return <div className="p-8 text-destructive">APQP project not found.</div>;

  const phaseIdx = PHASES.indexOf(proj.phase);
  const statusColors: Record<ApqpStatus, string> = {
    not_started: "bg-muted text-ink-3",
    in_progress: "bg-blue-100 text-blue-800",
    complete: "bg-green-100 text-green-800",
    blocked: "bg-red-100 text-red-800",
  };

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/quality/apqp")} className="hover:underline">APQP</button>
        <span className="mx-2">/</span>
        <span>{proj.name}</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{proj.name}</h1>
            <p className="text-sm text-ink-3 mt-1">Phase: <span className="capitalize font-medium">{proj.phase}</span> · Target: {proj.targetDate ?? "—"}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusColors[proj.status]}`}>
            {proj.status.replace("_", " ")}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {phaseIdx < PHASES.length - 1 && (
            <button onClick={advancePhase} disabled={saving}
              className="px-4 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50">
              Advance to {PHASES[phaseIdx + 1]}
            </button>
          )}
          {proj.status !== "in_progress" && proj.status !== "complete" && (
            <button onClick={() => setStatus("in_progress")} disabled={saving}
              className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              Start
            </button>
          )}
          {proj.status === "in_progress" && (
            <button onClick={() => setStatus("complete")} disabled={saving}
              className="px-4 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
              Complete
            </button>
          )}
          {proj.status !== "blocked" && proj.status !== "complete" && (
            <button onClick={() => setStatus("blocked")} disabled={saving}
              className="px-4 py-1.5 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-50">
              Block
            </button>
          )}
        </div>
      </div>

      {/* Phase progress */}
      <div className="rounded-lg border border-line bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3 mb-4">Phase Progress</h2>
        <div className="flex gap-1">
          {PHASES.map((ph, i) => (
            <div key={ph} className={`flex-1 h-2 rounded-full ${i <= phaseIdx ? "bg-primary" : "bg-muted"}`} />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-xs text-ink-3">
          <span className="capitalize">{PHASES[0]}</span>
          <span className="capitalize">{PHASES[PHASES.length - 1]}</span>
        </div>
      </div>

      {/* Milestones */}
      {proj.milestones && proj.milestones.length > 0 && (
        <div className="rounded-lg border border-line bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3 mb-4">
            Milestones ({proj.milestones.length})
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-3 text-xs uppercase">
                <th className="py-2 pr-4">Milestone</th>
                <th className="py-2 pr-4">Due Date</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {proj.milestones.map((m, idx) => (
                <tr key={idx} className="border-t border-line">
                  <td className="py-2 pr-4 font-medium">{m.name}</td>
                  <td className="py-2 pr-4 text-ink-3">{m.due || "—"}</td>
                  <td className="py-2">
                    {m.done ? (
                      <span className="text-green-600 font-medium">Done</span>
                    ) : (
                      <span className="text-ink-3">Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
