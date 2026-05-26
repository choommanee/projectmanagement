"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, FolderOpen, LayoutTemplate, Clock } from "lucide-react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listDocuments,
  listAllWorkspaces,
  listTemplates,
  type DocSummary,
  type Workspace,
} from "@/lib/api/documents";

function relTime(iso: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "<1h ago";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface KpiTileProps {
  label: string;
  value: number | string;
  sub: string;
  icon: React.ReactNode;
}

function KpiTile({ label, value, sub, icon }: KpiTileProps) {
  return (
    <div className="rounded-sm border border-line bg-surface p-4 shadow-xs">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">{label}</span>
        <span className="text-ink-3">{icon}</span>
      </div>
      <div className="font-mono text-2xl font-semibold text-ink tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-3">{sub}</div>
    </div>
  );
}

const DOC_TYPE_LABELS: Record<string, string> = {
  project_charter: "Project Charter", status_report: "Status Report",
  risk_register: "Risk Register", issue_log: "Issue Log",
  change_request: "Change Request", stakeholder_register: "Stakeholder Register",
  brd: "BRD", frd: "FRD", user_story: "User Story", use_case: "Use Case",
  process_flow: "Process Flow", rtm: "RTM",
  sdd: "SDD", adr: "ADR", er_diagram: "ER Diagram", api_spec: "API Spec",
  sequence_diagram: "Sequence Diagram", tech_stack: "Tech Stack",
  knowledge_article: "Knowledge Article", decision_log: "Decision Log",
  qa: "Q&A", lesson_learned: "Lesson Learned", expertise_profile: "Expertise Profile",
  note: "Note",
};

const STATUS_TONES: Record<string, string> = {
  draft:    "bg-surface-2 text-ink-3 border-line",
  review:   "bg-warning/10 text-warning border-warning/30",
  approved: "bg-success/10 text-success border-success/30",
  archived: "bg-surface-2 text-ink-3 border-line",
};

export default function DocsHomePage() {
  const router = useRouter();
  const [totalDocs, setTotalDocs] = useState<number | null>(null);
  const [totalWorkspaces, setTotalWorkspaces] = useState<number | null>(null);
  const [totalTemplates, setTotalTemplates] = useState<number | null>(null);
  const [recentDocs, setRecentDocs] = useState<DocSummary[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      listDocuments({ limit: 5 }),
      listDocuments({ limit: 1 }),
      listAllWorkspaces({ limit: 200 }),
      listTemplates().catch(() => null),
    ])
      .then(([recent, all, ws, templates]) => {
        setRecentDocs(recent.items);
        setTotalDocs(all.total);
        setWorkspaces(ws.items);
        setTotalWorkspaces(ws.total);
        setTotalTemplates(templates ? templates.length : null);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Document Hub", href: "/docs/home" }, { label: "Dashboard" }]} />

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Dashboard</p>
          <h1 className="mt-0.5 text-xl font-semibold text-ink">Document Hub</h1>
        </div>

        {error && (
          <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
            {error}
          </div>
        )}

        {loading ? (
          <div className="font-mono text-[11px] text-ink-3">Loading dashboard…</div>
        ) : (
          <>
            {/* KPI row */}
            <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KpiTile
                label="Total Documents"
                value={totalDocs !== null ? totalDocs : "—"}
                sub="across all workspaces"
                icon={<FileText size={16} />}
              />
              <KpiTile
                label="Workspaces"
                value={totalWorkspaces !== null ? totalWorkspaces : "—"}
                sub="BA / SA / PM / Expert"
                icon={<FolderOpen size={16} />}
              />
              <KpiTile
                label="Templates"
                value={totalTemplates !== null ? totalTemplates : "—"}
                sub="system + custom"
                icon={<LayoutTemplate size={16} />}
              />
            </div>

            {/* Recent documents table */}
            <div className="rounded-sm border border-line bg-surface shadow-xs">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-3">
                  <Clock size={11} /> Recent Documents
                </span>
                <button
                  type="button"
                  onClick={() => router.push("/docs/documents")}
                  className="font-mono text-[10px] text-accent hover:underline"
                >
                  View all
                </button>
              </div>

              {recentDocs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-ink-3">No documents yet.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Title</th>
                      <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Type</th>
                      <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Status</th>
                      <th className="px-4 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Workspace</th>
                      <th className="px-4 py-2 text-right font-mono text-[10px] uppercase tracking-wider text-ink-3">Modified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDocs.map((doc) => {
                      const ws = workspaces.find((w) => w.id === doc.workspaceId);
                      return (
                        <tr
                          key={doc.id}
                          className="border-b border-line last:border-0 hover:bg-surface-2 cursor-pointer"
                          onClick={() => router.push(`/docs/documents`)}
                        >
                          <td className="px-4 py-2.5 font-medium text-ink">{doc.title}</td>
                          <td className="px-4 py-2.5">
                            <span className="font-mono text-[10px] text-ink-3">
                              {DOC_TYPE_LABELS[doc.type] ?? doc.type}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-block rounded-xs border px-1.5 py-0.5 font-mono text-[10px] capitalize ${STATUS_TONES[doc.status] ?? "bg-surface-2 text-ink-3 border-line"}`}>
                              {doc.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-sm text-ink-3">{ws?.name ?? doc.workspaceId}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-[11px] text-ink-3 tabular-nums">
                            {relTime(doc.updatedAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
