"use client";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  getDocument, updateDocument, listVersions, listComments, createComment,
  restoreVersion, resolveComment, deleteComment, createTemplate,
  type Document, type DocumentVersion, type DocComment, type DocumentStatus,
} from "@/lib/api/documents";
import { Button, Dialog, Input } from "@pmplatform/ui-kit";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import { RunWorkflowButton } from "@/components/RunWorkflowButton";
import { RequestApprovalDialog } from "@/components/RequestApprovalDialog";
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
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab | null) ?? "content";
  const tApproval = useTranslations("approval");
  const [showApproval, setShowApproval] = useState(false);

  const [doc, setDoc]           = useState<Document | null>(null);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [tab, setTab]           = useState<Tab>(
    initialTab === "signatures" || initialTab === "versions" || initialTab === "comments" ? initialTab : "content",
  );

  // comment form
  const [commentBody, setCommentBody] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  // editor body (JSON from TipTap)
  const [bodyJson, setBodyJson] = useState<Record<string, unknown> | null>(null);
  const [bodyDirty, setBodyDirty] = useState(false);

  // version restore + comment moderation
  const [restoringRev, setRestoringRev] = useState<number | null>(null);

  // tag editing
  const [editingTags, setEditingTags] = useState(false);
  const [tagsDraft, setTagsDraft] = useState("");

  // save-as-template
  const [showSaveTmpl, setShowSaveTmpl] = useState(false);
  const [tmplName, setTmplName] = useState("");
  const [savingTmpl, setSavingTmpl] = useState(false);
  const [tmplError, setTmplError] = useState<string | null>(null);
  const [tmplDone, setTmplDone] = useState<string | null>(null);

  function openSaveTemplate() {
    if (!doc) return;
    setTmplName(doc.title);
    setTmplError(null);
    setTmplDone(null);
    setShowSaveTmpl(true);
  }

  async function saveAsTemplate(e?: React.FormEvent) {
    e?.preventDefault();
    if (!doc) return;
    if (!tmplName.trim()) { setTmplError("Name is required."); return; }
    setSavingTmpl(true); setTmplError(null);
    try {
      // Use the live editor body when present (so unsaved edits are captured),
      // falling back to the persisted document body.
      const body = (bodyJson ?? doc.body) as Record<string, unknown>;
      const t = await createTemplate({ name: tmplName.trim(), type: doc.type, body });
      setTmplDone(t.id);
    } catch (err) {
      setTmplError(err instanceof Error ? err.message : "Failed to save template");
    } finally {
      setSavingTmpl(false);
    }
  }

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

  async function handleRestore(rev: number) {
    if (!doc) return;
    setRestoringRev(rev);
    try {
      const updated = await restoreVersion(doc.id, rev, doc.version);
      setDoc(updated);
      if (updated.body && typeof updated.body === "object") setBodyJson(updated.body as Record<string, unknown>);
      setBodyDirty(false);
      setVersions(await listVersions(updated.id));
    } catch (err) {
      console.error(err);
    } finally { setRestoringRev(null); }
  }

  async function handleResolveComment(commentId: string) {
    try {
      await resolveComment(commentId);
      setComments(prev => prev.map(c => c.id === commentId ? { ...c, resolvedAt: new Date().toISOString() } : c));
    } catch (err) { console.error(err); }
  }

  async function handleDeleteComment(commentId: string) {
    try {
      await deleteComment(commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch (err) { console.error(err); }
  }

  function startEditTags() {
    if (!doc) return;
    setTagsDraft((doc.tags ?? []).join(", "));
    setEditingTags(true);
  }

  async function saveTags() {
    if (!doc) return;
    const tags = tagsDraft.split(",").map(t => t.trim()).filter(Boolean);
    setSaving(true);
    try {
      const updated = await updateDocument(doc.id, { tags, version: doc.version });
      setDoc(updated);
      setEditingTags(false);
    } finally { setSaving(false); }
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
            </p>
            {/* Tags row (editable) */}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {editingTags ? (
                <>
                  <input
                    value={tagsDraft}
                    onChange={e => setTagsDraft(e.target.value)}
                    placeholder="tag-a, tag-b"
                    autoFocus
                    className="rounded border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-ink focus:border-accent focus:outline-none"
                  />
                  <button onClick={saveTags} disabled={saving}
                    className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/15 disabled:opacity-50">
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button onClick={() => setEditingTags(false)}
                    className="rounded border border-line px-2 py-0.5 text-[10px] text-ink-3 hover:bg-surface-2">
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {(doc.tags ?? []).map(t => (
                    <span key={t} className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] text-ink-2">{t}</span>
                  ))}
                  <button onClick={startEditTags}
                    className="rounded border border-dashed border-line px-1.5 py-0.5 text-[10px] text-ink-3 hover:bg-surface-2">
                    {doc.tags && doc.tags.length > 0 ? "Edit tags" : "+ Add tags"}
                  </button>
                </>
              )}
            </div>
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
          <button
            onClick={() => setShowApproval(true)}
            className="inline-flex items-center gap-1.5 rounded border border-signal/40 bg-signal/10 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/15"
          >
            <ShieldCheck size={13} />
            {tApproval("launch")}
          </button>
          <button
            onClick={openSaveTemplate}
            className="rounded border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2"
          >
            Save as Template
          </button>
        </div>
      </div>

      <Dialog open={showSaveTmpl} onClose={() => setShowSaveTmpl(false)} title="Save as Template">
        <form onSubmit={saveAsTemplate} className="space-y-4 p-4">
          {tmplError && (
            <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">{tmplError}</div>
          )}
          {tmplDone ? (
            <div className="space-y-3">
              <div className="rounded-sm border border-success/30 bg-success/5 px-3 py-2 font-mono text-[11px] text-success">
                Template created from this document.
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" type="button" onClick={() => setShowSaveTmpl(false)}>Close</Button>
                <Button variant="primary" type="button" onClick={() => router.push("/docs/templates/" + tmplDone)}>
                  Open Template
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">Template Name</label>
                <Input value={tmplName} onChange={(e) => setTmplName(e.target.value)} autoFocus />
              </div>
              <p className="font-mono text-[10px] text-ink-3">
                Type: {doc.type?.replace(/_/g, " ")} · the current document body is copied into a reusable template.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" type="button" onClick={() => setShowSaveTmpl(false)}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={savingTmpl}>
                  {savingTmpl ? "Saving…" : "Save Template"}
                </Button>
              </div>
            </>
          )}
        </form>
      </Dialog>

      <RequestApprovalDialog
        open={showApproval}
        documentId={doc.id}
        projectId={doc.projectId}
        onClose={() => setShowApproval(false)}
      />

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
            <SignaturePanel
              documentId={id}
              onEnvelopeChanged={(env) => {
                // completed envelopes flip the document status server-side
                if (env.status === "completed") void load();
              }}
            />
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
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-ink-3">Note</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-ink-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {versions.map((v, i) => (
                    <tr key={v.id} className="border-t border-line hover:bg-surface-2/30">
                      <td className="px-4 py-2.5 font-mono text-sm">v{v.rev}</td>
                      <td className="px-4 py-2.5 text-ink-2">{v.createdAt ? v.createdAt.slice(0, 10) : "—"}</td>
                      <td className="px-4 py-2.5 font-mono text-[11px] text-ink-3">{v.createdBy ?? "—"}</td>
                      <td className="px-4 py-2.5 text-[11px] text-ink-3">{v.note || "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        {i === 0 ? (
                          <span className="font-mono text-[10px] text-ink-3">current</span>
                        ) : (
                          <button
                            onClick={() => handleRestore(v.rev)}
                            disabled={restoringRev !== null}
                            className="rounded border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent hover:bg-accent/15 disabled:opacity-50"
                          >
                            {restoringRev === v.rev ? "Restoring…" : "Restore"}
                          </button>
                        )}
                      </td>
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
                    <span className="font-mono font-medium text-ink-2">{c.authorId ?? "Unknown"}</span>
                    <span>{c.createdAt ? c.createdAt.slice(0, 10) : ""}</span>
                    {c.resolvedAt && (
                      <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-medium text-success">Resolved</span>
                    )}
                    <span className="ml-auto flex items-center gap-1.5">
                      {!c.resolvedAt && (
                        <button onClick={() => handleResolveComment(c.id)}
                          className="rounded border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success hover:bg-success/15">
                          Resolve
                        </button>
                      )}
                      <button onClick={() => handleDeleteComment(c.id)}
                        className="rounded border border-danger/40 bg-danger/5 px-2 py-0.5 text-[10px] font-medium text-danger hover:bg-danger/10">
                        Delete
                      </button>
                    </span>
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
