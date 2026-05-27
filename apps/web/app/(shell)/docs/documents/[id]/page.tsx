"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  getDocument, updateDocument, listVersions, listComments, createComment,
  type Document, type DocumentVersion, type DocComment, type DocumentStatus,
} from "@/lib/api/documents";
import { RunWorkflowButton } from "@/components/RunWorkflowButton";
import { SignaturePanel } from "@/components/SignaturePanel";
import { DocEditor } from "@/components/DocEditor";
import { Breadcrumb } from "@/shell/Breadcrumb";

const STATUS_COLORS: Record<DocumentStatus, string> = {
  draft:    "bg-surface-2 text-ink-3",
  review:   "bg-warning/10 text-warning",
  approved: "bg-success/10 text-success",
  archived: "bg-surface-2 text-ink-2",
};

const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: "Draft", review: "In Review", approved: "Approved", archived: "Archived",
};

type Tab = "content" | "signatures" | "versions" | "comments";

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [doc, setDoc]           = useState<Document | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [tab, setTab]           = useState<Tab>("content");

  // comment form
  const [commentBody, setCommentBody] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  // editor body (JSON from TipTap)
  const [bodyJson, setBodyJson] = useState<Record<string, unknown> | null>(null);
  const [bodyDirty, setBodyDirty] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [d, v, c] = await Promise.all([getDocument(id), listVersions(id), listComments(id)]);
      setDoc(d);
      setVersions(v);
      setComments(c);
      if (d.body && typeof d.body === "object") setBodyJson(d.body as Record<string, unknown>);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function handleStatus(status: DocumentStatus) {
    if (!doc) return;
    setSaving(true);
    try {
      const updated = await updateDocument(doc.id, { status, version: doc.version });
      setDoc(updated);
    } finally { setSaving(false); }
  }

  async function saveBody() {
    if (!doc || !bodyJson) return;
    setSaving(true);
    try {
      const updated = await updateDocument(doc.id, { body: bodyJson, version: doc.version });
      setDoc(updated);
      setBodyDirty(false);
    } finally { setSaving(false); }
  }

  async function postComment() {
    if (!id || !commentBody.trim()) return;
    setPostingComment(true);
    try {
      const c = await createComment(id, commentBody.trim());
      setComments(prev => [...prev, c]);
      setCommentBody("");
    } finally { setPostingComment(false); }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse text-sm text-ink-3">Loading document…</div>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="p-8">
        <p className="text-danger">Document not found.</p>
        <button onClick={() => router.push("/docs/documents")} className="mt-2 text-sm text-accent underline">
          ← Back to Documents
        </button>
      </div>
    );
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "content",    label: "Content" },
    { id: "signatures", label: "Signatures" },
    { id: "versions",   label: `Versions (${versions.length})` },
    { id: "comments",   label: `Comments (${comments.length})` },
  ];

  const editable = doc.status === "draft";

  return (
    <div className="flex h-full flex-col overflow-auto">
      <Breadcrumb
        items={[
          { label: "Docs", href: "/docs/home" },
          { label: "Documents", href: "/docs/documents" },
          { label: doc.title },
        ]}
      />

      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="border-b border-line bg-paper px-6 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold text-ink">{doc.title}</h1>
            <p className="mt-0.5 text-xs text-ink-3 capitalize">
              {doc.type?.replace(/_/g, " ")} · v{doc.version}
              {doc.tags && doc.tags.length > 0 && (
                <span className="ml-2">
                  {doc.tags.map(t => (
                    <span key={t} className="mr-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px]">{t}</span>
                  ))}
                </span>
              )}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${STATUS_COLORS[doc.status]}`}>
            {STATUS_LABELS[doc.status]}
          </span>
        </div>

        {/* Action buttons */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {doc.status === "draft" && (
            <button onClick={() => handleStatus("review")} disabled={saving}
              className="rounded border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning/15 disabled:opacity-50">
              Submit for Review
            </button>
          )}
          {doc.status === "review" && (
            <button onClick={() => handleStatus("approved")} disabled={saving}
              className="rounded border border-success/40 bg-success/10 px-3 py-1.5 text-xs font-medium text-success hover:bg-success/15 disabled:opacity-50">
              Approve
            </button>
          )}
          {doc.status !== "archived" && (
            <button onClick={() => handleStatus("archived")} disabled={saving}
              className="rounded border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 disabled:opacity-50">
              Archive
            </button>
          )}
          {bodyDirty && (
            <button onClick={saveBody} disabled={saving}
              className="rounded border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/15 disabled:opacity-50">
              {saving ? "Saving…" : "Save Changes"}
            </button>
          )}
          <RunWorkflowButton context={{ document_id: id, document_title: doc.title }} />
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="border-b border-line bg-paper px-6">
        <nav className="flex gap-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? "border-accent text-accent"
                  : "border-transparent text-ink-3 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* ── Tab content ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-6">

        {/* Content / Editor */}
        {tab === "content" && (
          <div className="mx-auto max-w-3xl">
            {editable ? (
              <div className="rounded-md border border-line bg-paper">
                <DocEditor
                  value={bodyJson}
                  onChange={(json) => { setBodyJson(json); setBodyDirty(true); }}
                  placeholder="Start writing your document…"
                />
              </div>
            ) : (
              <div className="rounded-md border border-line bg-paper">
                <DocEditor
                  value={bodyJson}
                  onChange={() => {}}
                  readOnly
                />
                {!bodyJson && (
                  <p className="px-6 py-10 text-center text-sm text-ink-3">
                    No content yet.
                    {doc.status === "draft" && " Submit this document as draft to edit its content."}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Signatures */}
        {tab === "signatures" && (
          <div className="mx-auto max-w-xl">
            <SignaturePanel documentId={id} />
          </div>
        )}

        {/* Versions */}
        {tab === "versions" && (
          <div className="overflow-hidden rounded-md border border-line bg-paper">
            {versions.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-ink-3">No version history.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2/50">
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-3">Version</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-3">Created</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-3">By</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map(v => (
                    <tr key={v.id} className="border-t border-line hover:bg-surface-2/30">
                      <td className="px-4 py-2.5 font-mono text-sm">v{v.rev}</td>
                      <td className="px-4 py-2.5 text-ink-2">{v.createdAt ? v.createdAt.slice(0, 10) : "—"}</td>
                      <td className="px-4 py-2.5 text-ink-3">{v.createdBy ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Comments */}
        {tab === "comments" && (
          <div className="mx-auto max-w-2xl space-y-4">
            {/* Post a comment */}
            <div className="rounded-md border border-line bg-paper p-4">
              <textarea
                rows={3}
                value={commentBody}
                onChange={e => setCommentBody(e.target.value)}
                placeholder="Add a comment…"
                className="w-full resize-none rounded border border-line bg-surface p-2 text-sm text-ink placeholder-ink-3 focus:border-accent focus:outline-none"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={postComment}
                  disabled={postingComment || !commentBody.trim()}
                  className="rounded border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/15 disabled:opacity-40"
                >
                  {postingComment ? "Posting…" : "Post Comment"}
                </button>
              </div>
            </div>

            {/* Comment list */}
            {comments.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-3">No comments yet. Be the first to comment.</p>
            ) : (
              comments.map(c => (
                <div key={c.id} className={`rounded-md border border-line bg-paper p-4 ${c.resolvedAt ? "opacity-60" : ""}`}>
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-3">
                    <span className="font-medium text-ink-2">{c.authorId ?? "Unknown"}</span>
                    <span>{c.createdAt ? c.createdAt.slice(0, 10) : ""}</span>
                    {c.resolvedAt && (
                      <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">Resolved</span>
                    )}
                  </div>
                  <p className="text-sm text-ink">{c.body}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
