"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listJobPostings, createJobPosting, updateJobPosting,
  listApplicants, createApplicant, updateApplicantStage,
  type JobPosting, type Applicant, type JobStatus, type ApplicantStage,
} from "@/lib/api/hr";

const JOB_STATUS_COLORS: Record<JobStatus, string> = {
  draft: "bg-surface-2 text-ink-3",
  open: "bg-green-100 text-green-700",
  on_hold: "bg-amber-100 text-amber-700",
  closed: "bg-zinc-200 text-zinc-500",
};

const STAGES: ApplicantStage[] = ["applied", "screening", "interview", "offer", "hired", "rejected"];

const STAGE_COLORS: Record<ApplicantStage, string> = {
  applied: "bg-zinc-200",
  screening: "bg-blue-200",
  interview: "bg-indigo-200",
  offer: "bg-amber-200",
  hired: "bg-green-200",
  rejected: "bg-red-100",
};

export default function RecruitmentPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [selected, setSelected] = useState<JobPosting | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewJob, setShowNewJob] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newOpenings, setNewOpenings] = useState("1");
  const [showNewApplicant, setShowNewApplicant] = useState(false);
  const [appName, setAppName] = useState("");
  const [appEmail, setAppEmail] = useState("");

  useEffect(() => {
    listJobPostings().then(r => setJobs(r.items)).finally(() => setLoading(false));
  }, []);

  async function selectJob(job: JobPosting) {
    setSelected(job);
    const apps = await listApplicants(job.id);
    setApplicants(apps);
  }

  async function handleCreateJob() {
    if (!newTitle) return;
    const job = await createJobPosting({ title: newTitle, openings: parseInt(newOpenings) || 1 });
    setJobs(prev => [job, ...prev]);
    setShowNewJob(false);
    setNewTitle(""); setNewOpenings("1");
  }

  async function handleAddApplicant() {
    if (!selected || !appName || !appEmail) return;
    const app = await createApplicant(selected.id, { name: appName, email: appEmail });
    setApplicants(prev => [app, ...prev]);
    setShowNewApplicant(false);
    setAppName(""); setAppEmail("");
  }

  async function advanceStage(app: Applicant) {
    if (!selected) return;
    const nextIdx = STAGES.indexOf(app.stage) + 1;
    if (nextIdx >= STAGES.length) return;
    const updated = await updateApplicantStage(selected.id, app.id, STAGES[nextIdx]);
    setApplicants(prev => prev.map(a => a.id === updated.id ? updated : a));
  }

  async function toggleJobStatus(job: JobPosting) {
    const newStatus: JobStatus = job.status === "open" ? "closed" : "open";
    const updated = await updateJobPosting(job.id, { status: newStatus });
    setJobs(prev => prev.map(j => j.id === updated.id ? updated : j));
    if (selected?.id === updated.id) setSelected(updated);
  }

  const stageGroups = STAGES.reduce((acc, stage) => {
    acc[stage] = applicants.filter(a => a.stage === stage);
    return acc;
  }, {} as Record<ApplicantStage, Applicant[]>);

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Recruitment" }]} />

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Job Postings</h2>
            <button onClick={() => setShowNewJob(true)} className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90">+ New Job</button>
          </div>

          {showNewJob && (
            <div className="rounded border border-line bg-surface p-3 space-y-2">
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Job title"
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface" />
              <input type="number" value={newOpenings} onChange={e => setNewOpenings(e.target.value)} placeholder="Openings"
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface" min="1" />
              <div className="flex gap-2">
                <button onClick={handleCreateJob} className="px-2 py-1 text-xs rounded bg-accent text-white">Create</button>
                <button onClick={() => setShowNewJob(false)} className="px-2 py-1 text-xs rounded border border-line">Cancel</button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            {loading && <div className="text-sm text-ink-3">Loading…</div>}
            {jobs.map(job => (
              <div key={job.id}
                onClick={() => router.push('/hr/recruitment/' + job.id)}
                className={`rounded-lg border p-3 cursor-pointer transition-colors ${selected?.id === job.id ? "border-accent bg-accent/5" : "border-line hover:bg-surface-2"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{job.title}</div>
                    <div className="text-xs text-ink-3 mt-0.5">{job.departmentName || "—"} · {job.openings} opening{job.openings !== 1 ? "s" : ""}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${JOB_STATUS_COLORS[job.status]}`}>{job.status}</span>
                    <button onClick={e => { e.stopPropagation(); toggleJobStatus(job); }}
                      className="text-xs text-ink-3 hover:text-ink">
                      {job.status === "open" ? "Close" : "Open"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">{selected ? `Applicants — ${selected.title}` : "Select a job"}</h2>
            {selected && (
              <button onClick={() => setShowNewApplicant(true)} className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90">+ Add Applicant</button>
            )}
          </div>

          {selected && showNewApplicant && (
            <div className="rounded border border-line bg-surface p-3 space-y-2">
              <input value={appName} onChange={e => setAppName(e.target.value)} placeholder="Full name"
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface" />
              <input value={appEmail} onChange={e => setAppEmail(e.target.value)} placeholder="Email"
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface" />
              <div className="flex gap-2">
                <button onClick={handleAddApplicant} className="px-2 py-1 text-xs rounded bg-accent text-white">Add</button>
                <button onClick={() => setShowNewApplicant(false)} className="px-2 py-1 text-xs rounded border border-line">Cancel</button>
              </div>
            </div>
          )}

          {selected ? (
            <div className="space-y-2">
              {STAGES.filter(s => s !== "rejected").map(stage => {
                const stageApps = stageGroups[stage] ?? [];
                return (
                  <div key={stage}>
                    <div className={`rounded-t px-3 py-1.5 text-xs font-semibold ${STAGE_COLORS[stage]}`}>
                      {stage.charAt(0).toUpperCase() + stage.slice(1)} ({stageApps.length})
                    </div>
                    <div className="rounded-b border border-t-0 border-line bg-surface p-2 space-y-1 min-h-[48px]">
                      {stageApps.map(app => (
                        <div key={app.id} className="flex items-center justify-between rounded border border-line px-2 py-1.5 bg-surface">
                          <div>
                            <div className="text-xs font-medium">{app.name}</div>
                            <div className="text-xs text-ink-3">{app.email}</div>
                          </div>
                          {stage !== "hired" && (
                            <button onClick={() => advanceStage(app)}
                              className="px-1.5 py-0.5 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20">
                              →
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-ink-3 py-8 text-center">Click a job posting to view applicants</div>
          )}
        </div>
      </div>
    </div>
  );
}
