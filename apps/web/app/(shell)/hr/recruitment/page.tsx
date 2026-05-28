"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Tag, Dialog, Input } from "@pmplatform/ui-kit";
import {
  listJobPostings, createJobPosting, updateJobPosting, deleteJobPosting,
  listApplicants, createApplicant, updateApplicantStage,
  type JobPosting, type Applicant, type JobStatus, type ApplicantStage,
} from "@/lib/api/hr";

const JOB_STATUS_VALUES: JobStatus[] = ["draft", "open", "on_hold", "closed", "cancelled" as JobStatus];

const JOB_STATUS_TONES: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  open: "success",
  on_hold: "warning",
  closed: "neutral",
  cancelled: "danger",
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

function EditJobDialog({
  job,
  onClose,
  onUpdated,
}: {
  job: JobPosting | null;
  onClose: () => void;
  onUpdated: (j: JobPosting) => void;
}) {
  const [status, setStatus] = useState<string>("draft");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (job) {
      setStatus(job.status);
      setError(null);
    }
  }, [job]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!job) return;
    setLoading(true);
    try {
      const updated = await updateJobPosting(job.id, { status: status as JobStatus });
      onUpdated(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={job !== null} onClose={onClose} title="Edit Job Posting">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[320px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        {job && (
          <div className="border-b border-line pb-2 mb-1">
            <p className="text-sm font-medium">{job.title}</p>
            {job.departmentName && (
              <p className="text-xs text-ink-3">{job.departmentName}</p>
            )}
          </div>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {JOB_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ")}</option>
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
  const [editing, setEditing] = useState<JobPosting | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    listJobPostings().then((r) => setJobs(r.items)).finally(() => setLoading(false));
  }, []);

  async function selectJob(job: JobPosting) {
    setSelected(job);
    const apps = await listApplicants(job.id);
    setApplicants(apps);
  }

  async function handleCreateJob() {
    if (!newTitle) return;
    const job = await createJobPosting({ title: newTitle, openings: parseInt(newOpenings) || 1 });
    setJobs((prev) => [job, ...prev]);
    setShowNewJob(false);
    setNewTitle("");
    setNewOpenings("1");
  }

  async function handleAddApplicant() {
    if (!selected || !appName || !appEmail) return;
    const app = await createApplicant(selected.id, { name: appName, email: appEmail });
    setApplicants((prev) => [app, ...prev]);
    setShowNewApplicant(false);
    setAppName("");
    setAppEmail("");
  }

  async function advanceStage(app: Applicant) {
    if (!selected) return;
    const nextIdx = STAGES.indexOf(app.stage) + 1;
    if (nextIdx >= STAGES.length) return;
    const updated = await updateApplicantStage(selected.id, app.id, STAGES[nextIdx]);
    setApplicants((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  }

  async function handleDelete(job: JobPosting) {
    if (!confirm(`Cancel/delete job posting "${job.title}"?`)) return;
    setDeleting(job.id);
    setDeleteError(null);
    try {
      await deleteJobPosting(job.id);
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      if (selected?.id === job.id) {
        setSelected(null);
        setApplicants([]);
      }
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeleting(null);
    }
  }

  const stageGroups = STAGES.reduce((acc, stage) => {
    acc[stage] = applicants.filter((a) => a.stage === stage);
    return acc;
  }, {} as Record<ApplicantStage, Applicant[]>);

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "HR" }, { label: "Recruitment" }]} />

      {deleteError && (
        <div className="rounded border border-danger/30 bg-danger/5 px-4 py-2 text-sm text-danger">
          {deleteError}
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Job Postings</h2>
            <button
              onClick={() => setShowNewJob(true)}
              className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90"
            >
              + New Job
            </button>
          </div>

          {showNewJob && (
            <div className="rounded border border-line bg-surface p-3 space-y-2">
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Job title"
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface"
              />
              <input
                type="number"
                value={newOpenings}
                onChange={(e) => setNewOpenings(e.target.value)}
                placeholder="Openings"
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface"
                min="1"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreateJob}
                  className="px-2 py-1 text-xs rounded bg-accent text-white"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowNewJob(false)}
                  className="px-2 py-1 text-xs rounded border border-line"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            {loading && <div className="text-sm text-ink-3">Loading…</div>}
            {jobs.map((job) => (
              <div
                key={job.id}
                onClick={() => selectJob(job)}
                className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                  selected?.id === job.id ? "border-accent bg-accent/5" : "border-line hover:bg-surface-2"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{job.title}</div>
                    <div className="text-xs text-ink-3 mt-0.5">
                      {job.departmentName || "—"} · {job.openings} opening{job.openings !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Tag
                      tone={JOB_STATUS_TONES[job.status] ?? "neutral"}
                      size="sm"
                    >
                      {job.status}
                    </Tag>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditing(job); }}
                      className="text-xs text-ink-3 hover:text-ink border border-line rounded px-1.5 py-0.5 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(job); }}
                      disabled={deleting === job.id}
                      className="text-xs text-danger hover:text-danger/80 border border-danger/30 rounded px-1.5 py-0.5 disabled:opacity-40 transition-colors"
                    >
                      {deleting === job.id ? "…" : "Del"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); router.push("/hr/recruitment/" + job.id); }}
                      className="text-xs text-ink-3 hover:text-ink"
                    >
                      Detail
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {selected ? `Applicants — ${selected.title}` : "Select a job"}
            </h2>
            {selected && (
              <button
                onClick={() => setShowNewApplicant(true)}
                className="px-2 py-1 text-xs rounded bg-accent text-white hover:bg-accent/90"
              >
                + Add Applicant
              </button>
            )}
          </div>

          {selected && showNewApplicant && (
            <div className="rounded border border-line bg-surface p-3 space-y-2">
              <input
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                placeholder="Full name"
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface"
              />
              <input
                value={appEmail}
                onChange={(e) => setAppEmail(e.target.value)}
                placeholder="Email"
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleAddApplicant}
                  className="px-2 py-1 text-xs rounded bg-accent text-white"
                >
                  Add
                </button>
                <button
                  onClick={() => setShowNewApplicant(false)}
                  className="px-2 py-1 text-xs rounded border border-line"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {selected ? (
            <div className="space-y-2">
              {STAGES.filter((s) => s !== "rejected").map((stage) => {
                const stageApps = stageGroups[stage] ?? [];
                return (
                  <div key={stage}>
                    <div className={`rounded-t px-3 py-1.5 text-xs font-semibold ${STAGE_COLORS[stage]}`}>
                      {stage.charAt(0).toUpperCase() + stage.slice(1)} ({stageApps.length})
                    </div>
                    <div className="rounded-b border border-t-0 border-line bg-surface p-2 space-y-1 min-h-[48px]">
                      {stageApps.map((app) => (
                        <div
                          key={app.id}
                          className="flex items-center justify-between rounded border border-line px-2 py-1.5 bg-surface"
                        >
                          <div>
                            <div className="text-xs font-medium">{app.name}</div>
                            <div className="text-xs text-ink-3">{app.email}</div>
                          </div>
                          {stage !== "hired" && (
                            <button
                              onClick={() => advanceStage(app)}
                              className="px-1.5 py-0.5 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20"
                            >
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
            <div className="text-sm text-ink-3 py-8 text-center">
              Click a job posting to view applicants
            </div>
          )}
        </div>
      </div>

      <EditJobDialog
        job={editing}
        onClose={() => setEditing(null)}
        onUpdated={(updated) => {
          setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
          if (selected?.id === updated.id) setSelected(updated);
          setEditing(null);
        }}
      />
    </div>
  );
}
