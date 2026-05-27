"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getJobPosting, listApplicants, updateApplicantStage,
  type JobPosting, type Applicant, type ApplicantStage, type JobStatus,
} from "@/lib/api/hr";

const STAGES: ApplicantStage[] = ["applied", "screening", "interview", "offer", "hired", "rejected"];

export default function JobPostingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<JobPosting | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [moving, setMoving] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([getJobPosting(id), listApplicants(id)])
      .then(([j, a]) => { setJob(j); setApplicants(a); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  async function moveApplicant(applicantId: string, stage: ApplicantStage) {
    if (!job) return;
    setMoving(applicantId);
    try {
      const updated = await updateApplicantStage(job.id, applicantId, stage);
      setApplicants(prev => prev.map(a => a.id === applicantId ? updated : a));
    } finally { setMoving(null); }
  }

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!job) return <div className="p-8 text-destructive">Job posting not found.</div>;

  const statusColors: Record<JobStatus, string> = {
    open: "bg-green-100 text-green-800",
    closed: "bg-gray-200 text-gray-500",
    draft: "bg-muted text-muted-foreground",
    on_hold: "bg-yellow-100 text-yellow-800",
  };

  const stageColors: Record<ApplicantStage, string> = {
    applied: "bg-blue-50 text-blue-700",
    screening: "bg-purple-50 text-purple-700",
    interview: "bg-yellow-50 text-yellow-700",
    offer: "bg-orange-50 text-orange-700",
    hired: "bg-green-50 text-green-700",
    rejected: "bg-red-50 text-red-700",
  };

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-muted-foreground">
        <button onClick={() => router.push("/hr/recruitment")} className="hover:underline">Recruitment</button>
        <span className="mx-2">/</span>
        <span>{job.title}</span>
      </nav>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{job.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {job.departmentName} · {job.positionName}
            </p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${statusColors[job.status]}`}>
            {job.status.replace("_", " ")}
          </span>
        </div>
        {job.description && (
          <p className="mt-3 text-sm text-muted-foreground">{job.description}</p>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Openings", value: String(job.openings ?? "—") },
          { label: "Total Applicants", value: String(applicants.length) },
          { label: "Department", value: job.departmentName },
          { label: "Position", value: job.positionName },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {/* Pipeline kanban columns */}
      <div className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Applicant Pipeline ({applicants.length})
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {STAGES.map(stage => {
            const stageApplicants = applicants.filter(a => a.stage === stage);
            return (
              <div key={stage} className="rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold capitalize ${stageColors[stage]}`}>
                    {stage}
                  </span>
                  <span className="text-xs text-muted-foreground">{stageApplicants.length}</span>
                </div>
                <div className="space-y-2">
                  {stageApplicants.map(a => (
                    <div key={a.id} className="bg-card rounded border border-border p-2 text-xs">
                      <p className="font-medium truncate">{a.name}</p>
                      <p className="text-muted-foreground truncate">{a.email}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Applicant table */}
      {applicants.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">All Applicants</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs uppercase">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Stage</th>
                <th className="py-2">Move To</th>
              </tr>
            </thead>
            <tbody>
              {applicants.map(a => {
                const currentIdx = STAGES.indexOf(a.stage);
                const nextStage = currentIdx < STAGES.length - 1 ? STAGES[currentIdx + 1] : null;
                return (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium">{a.name}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{a.email}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs capitalize ${stageColors[a.stage]}`}>
                        {a.stage}
                      </span>
                    </td>
                    <td className="py-2">
                      {nextStage && nextStage !== "rejected" && (
                        <button onClick={() => moveApplicant(a.id, nextStage)}
                          disabled={moving === a.id}
                          className="px-2 py-0.5 text-xs border border-border rounded hover:bg-muted disabled:opacity-50 capitalize">
                          → {nextStage}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
