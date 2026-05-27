"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listDocuments,
  listAllWorkspaces,
  createDocument,
  type DocSummary,
  type Workspace,
  type DocumentType,
  type DocumentStatus,
  TYPES_BY_KIND,
} from "@/lib/api/documents";

const STATUS_TONES: Record<DocumentStatus, "success" | "warning" | "neutral" | "signal" | "info"> = {
  draft:    "neutral",
  review:   "warning",
  approved: "success",
  archived: "neutral",
};

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

const ALL_DOC_TYPES: { value: DocumentType; label: string }[] = Object.values(TYPES_BY_KIND).flat();

function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

interface CreateDocDialogProps {
  open: boolean;
  workspaces: Workspace[];
  onClose: () => void;
  onCreated: (doc: DocSummary) => void;
}

function CreateDocDialog({ open, workspaces, onClose, onCreated }: CreateDocDialogProps) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocumentType>("note");
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaces.length > 0 && !workspaceId) setWorkspaceId(workspaces[0].id);
  }, [workspaces, workspaceId]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!title.trim() || !workspaceId) { setError("Title and Workspace are required."); return; }
    const ws = workspaces.find((w) => w.id === workspaceId);
    if (!ws) { setError("Invalid workspace."); return; }
    setLoading(true);
    setError(null);
    try {
      const doc = await createDocument({
        workspace_id: workspaceId,
        project_id: ws.projectId,
        type,
        title: title.trim(),
      });
      onCreated(doc);
      setTitle(""); setType("note"); setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create document");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Document">
      <form onSubmit={submit} className="space-y-4 p-4">
        {error && (
          <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">{error}</div>
        )}
        <div className="space-y-1">
          <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">Title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Document title…"
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as DocumentType)}
            className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
          >
            {ALL_DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">Workspace</label>
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.kind})</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={loading}>
            {loading ? "Creating…" : "Create Document"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function DocumentsPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback((q?: string) => {
    setLoading(true);
    Promise.all([
      listDocuments({ limit: 100, q: q || undefined }),
      listAllWorkspaces({ limit: 200 }),
    ])
      .then(([result, ws]) => {
        setDocs(result.items);
        setTotal(result.total);
        setWorkspaces(ws.items);
      })
      .catch((e: unknown) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [search, load]);

  const wsMap = Object.fromEntries(workspaces.map((w) => [w.id, w]));

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Document Hub", href: "/docs/home" }, { label: "All Documents" }]} />

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-3">Content</p>
            <h1 className="mt-0.5 text-xl font-semibold text-ink">All Documents</h1>
          </div>
          <Button
            variant="primary"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} />
            New Document
          </Button>
        </div>

        {/* Search bar */}
        <div className="mb-4 flex items-center gap-2">
          <div className="relative max-w-xs flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input
              placeholder="Search documents…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <span className="font-mono text-[11px] text-ink-3 tabular-nums">
            {total} document{total !== 1 ? "s" : ""}
          </span>
        </div>

        {error && (
          <div className="mb-4 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">{error}</div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="h-10 animate-pulse rounded-xs bg-surface-2" />
            ))}
          </div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-sm border border-dashed border-line py-20 text-center">
            <p className="text-sm text-ink-3">No documents found.</p>
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Create First Document
            </Button>
          </div>
        ) : (
          <div className="rounded-sm border border-line bg-surface shadow-xs overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/50">
                  <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Title</th>
                  <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Type</th>
                  <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Status</th>
                  <th className="px-4 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-ink-3">Workspace</th>
                  <th className="px-4 py-2.5 text-right font-mono text-[10px] uppercase tracking-wider text-ink-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((doc) => {
                  const ws = wsMap[doc.workspaceId];
                  return (
                    <tr
                      key={doc.id}
                      className="border-b border-line last:border-0 hover:bg-surface-2 cursor-pointer transition-colors"
                      onClick={() => router.push('/docs/documents/' + doc.id)}
                    >
                      <td className="px-4 py-2.5 font-medium text-ink">{doc.title}</td>
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-[10px] text-ink-3">
                          {DOC_TYPE_LABELS[doc.type] ?? doc.type}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Tag tone={STATUS_TONES[doc.status] ?? "neutral"}>{doc.status}</Tag>
                      </td>
                      <td className="px-4 py-2.5 text-sm text-ink-3">
                        {ws ? `${ws.name} (${ws.kind})` : doc.workspaceId}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-[11px] text-ink-3 tabular-nums">
                        {fmtDate(doc.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateDocDialog
        open={showCreate}
        workspaces={workspaces}
        onClose={() => setShowCreate(false)}
        onCreated={(doc) => {
          setDocs((prev) => [doc, ...prev]);
          setTotal((t) => t + 1);
          setShowCreate(false);
        }}
      />
    </div>
  );
}
