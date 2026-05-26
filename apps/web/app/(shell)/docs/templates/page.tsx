"use client";
import { useEffect, useState } from "react";
import { Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listTemplates, type Template, type DocumentType } from "@/lib/api/documents";

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

// Map doc type to workspace kind for display category
const TYPE_CATEGORY: Record<DocumentType, string> = {
  project_charter: "PM", status_report: "PM", risk_register: "PM",
  issue_log: "PM", change_request: "PM", stakeholder_register: "PM",
  brd: "BA", frd: "BA", user_story: "BA", use_case: "BA",
  process_flow: "BA", rtm: "BA",
  sdd: "SA", adr: "SA", er_diagram: "SA", api_spec: "SA",
  sequence_diagram: "SA", tech_stack: "SA",
  knowledge_article: "Expert", decision_log: "Expert", qa: "Expert",
  lesson_learned: "Expert", expertise_profile: "Expert",
  note: "General",
};

const CAT_TONES: Record<string, "success" | "accent" | "info" | "warning" | "neutral"> = {
  PM:      "success",
  BA:      "accent",
  SA:      "info",
  Expert:  "warning",
  General: "neutral",
};

function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noApi, setNoApi] = useState(false);

  useEffect(() => {
    listTemplates()
      .then(setTemplates)
      .catch((e: unknown) => {
        const msg = (e as Error).message ?? "";
        // 404 / not implemented → show coming-soon placeholder
        if (msg.includes("404") || msg.includes("501")) {
          setNoApi(true);
        } else {
          setError(msg);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Document Hub", href: "/docs/home" }, { label: "Templates" }]} />

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Content</p>
          <h1 className="mt-0.5 text-xl font-semibold text-ink">Templates</h1>
        </div>

        {error && (
          <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">{error}</div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-10 animate-pulse rounded-xs bg-surface-2" />
            ))}
          </div>
        ) : noApi || templates.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-sm border border-dashed border-line py-24 text-center">
            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Coming Soon</span>
            <p className="max-w-sm text-sm text-ink-3">
              Templates are not yet available. Once document-svc exposes the templates API,
              system-provided and custom templates will appear here for one-click document creation.
            </p>
          </div>
        ) : (
          <div className="rounded-sm border border-line bg-surface shadow-xs overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/50">
                  <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Name</th>
                  <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Type</th>
                  <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Category</th>
                  <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Source</th>
                  <th className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-wider text-ink-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((tmpl) => {
                  const category = TYPE_CATEGORY[tmpl.type] ?? "General";
                  return (
                    <tr
                      key={tmpl.id}
                      className="border-b border-line last:border-0 hover:bg-surface-2 cursor-default transition-colors"
                    >
                      <td className="px-4 py-2.5 font-medium text-ink">{tmpl.name}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-[10px] text-ink-3">
                          {DOC_TYPE_LABELS[tmpl.type] ?? tmpl.type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Tag tone={CAT_TONES[category] ?? "neutral"}>{category}</Tag>
                      </td>
                      <td className="px-4 py-2.5">
                        <Tag tone={tmpl.isSystem ? "info" : "neutral"}>
                          {tmpl.isSystem ? "System" : "Custom"}
                        </Tag>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[11px] text-ink-3 tabular-nums">
                        {fmtDate(tmpl.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
