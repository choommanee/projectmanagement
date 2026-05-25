"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  History,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import {
  ensureWorkspace,
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  listVersions,
  getVersion,
  restoreVersion,
  listComments,
  createComment,
  resolveComment,
  deleteComment,
  listTemplates,
  type Workspace,
  type Document,
  type DocSummary,
  type DocumentVersion,
  type DocComment,
  type Template,
  type WorkspaceKind,
  type DocumentType,
  type DocumentStatus,
  TYPES_BY_KIND,
} from "@/lib/api/documents";
import { DocEditor } from "@/components/DocEditor";
import { DocCover } from "@/components/DocCover";
import { WorkspaceDashboard } from "@/components/WorkspaceDashboard";
import { RTMView } from "@/components/RTMView";
import { ADRVotingPanel } from "@/components/ADRVotingPanel";

// ─── Props ────────────────────────────────────────────────────────────────────

export interface WorkspaceShellProps {
  projectId: string;
  kind: WorkspaceKind;
  allowedTypes: DocumentType[];
  workspaceName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typeLabel(t: DocumentType, kind: WorkspaceKind): string {
  return TYPES_BY_KIND[kind]?.find((x) => x.value === t)?.label ?? t;
}

function statusTone(s: DocumentStatus): "success" | "warning" | "neutral" | "signal" {
  switch (s) {
    case "approved": return "success";
    case "review": return "warning";
    case "archived": return "signal";
    default: return "neutral";
  }
}

function relativeTime(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function authorInitials(authorId?: string | null): string {
  if (!authorId) return "??";
  return authorId.slice(-6).toUpperCase();
}

const EMPTY_DOC = { type: "doc", content: [] } as Record<string, unknown>;

// ─── Save status tag ──────────────────────────────────────────────────────────

function SaveTag({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  if (status === "saving") return <span className="text-[11px] text-ink-3">Saving…</span>;
  if (status === "saved") return <span className="text-[11px] text-success">Saved</span>;
  return <span className="text-[11px] text-danger">Save error</span>;
}

// ─── WorkspaceShell ───────────────────────────────────────────────────────────

export function WorkspaceShell({ projectId, kind, allowedTypes, workspaceName }: WorkspaceShellProps) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<Document | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<DocumentType | "">("");

  const [editorValue, setEditorValue] = useState<Record<string, unknown>>(EMPTY_DOC);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [conflictError, setConflictError] = useState(false);

  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<DocComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [commentsBusy, setCommentsBusy] = useState(false);

  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [previewVersion, setPreviewVersion] = useState<DocumentVersion | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);

  const [showNewDocDialog, setShowNewDocDialog] = useState(false);
  const [initialDocType, setInitialDocType] = useState<DocumentType | undefined>(undefined);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const [mutError, setMutError] = useState<string | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentVersionRef = useRef<number>(1);

  // ── Bootstrap: ensure workspace, list docs ─────────────────────────────────

  const bootstrap = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const ws = await ensureWorkspace(projectId, kind, workspaceName);
      setWorkspace(ws);
      const { items } = await listDocuments({ workspace_id: ws.id, limit: 200 });
      setDocs(items);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId, kind, workspaceName]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  // ── Load document when selection changes ───────────────────────────────────

  const loadDoc = useCallback(async (id: string) => {
    try {
      const doc = await getDocument(id);
      setOpenDoc(doc);
      setEditorValue(doc.body ?? EMPTY_DOC);
      currentVersionRef.current = doc.version;
      setDirty(false);
      setSaving("idle");
      setConflictError(false);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Cancel any pending auto-save for the outgoing document before loading the new one
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    if (selectedDocId) void loadDoc(selectedDocId);
    else { setOpenDoc(null); setEditorValue(EMPTY_DOC); }
  }, [selectedDocId, loadDoc]);

  // ── Auto-save (debounced 1500ms) ───────────────────────────────────────────

  const doSave = useCallback(async (body: Record<string, unknown>, title?: string) => {
    if (!openDoc) return;
    setSaving("saving");
    setConflictError(false);
    try {
      const patch: Parameters<typeof updateDocument>[1] = {
        body,
        version: currentVersionRef.current,
      };
      if (title !== undefined) patch.title = title;
      const updated = await updateDocument(openDoc.id, patch);
      setOpenDoc(updated);
      currentVersionRef.current = updated.version;
      setDocs((prev) =>
        prev.map((d) =>
          d.id === updated.id
            ? { ...d, title: updated.title, updatedAt: updated.updatedAt, version: updated.version }
            : d,
        ),
      );
      setDirty(false);
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 2000);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
        setConflictError(true);
        setSaving("error");
      } else {
        setSaving("error");
        setTimeout(() => setSaving("idle"), 3000);
      }
    }
  }, [openDoc]);

  function onEditorChange(json: Record<string, unknown>) {
    setEditorValue(json);
    setDirty(true);
    setSaving("idle");
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => void doSave(json), 1500);
  }

  // Cmd-S manual save
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) void doSave(editorValue);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, doSave, editorValue]);

  // ── Title rename ───────────────────────────────────────────────────────────

  async function commitRename() {
    if (!openDoc || !renameValue.trim()) { setRenaming(false); return; }
    setRenaming(false);
    try {
      const updated = await updateDocument(openDoc.id, { title: renameValue.trim(), body: editorValue, version: currentVersionRef.current });
      setOpenDoc(updated);
      currentVersionRef.current = updated.version;
      setDocs((prev) => prev.map((d) => d.id === updated.id ? { ...d, title: updated.title, version: updated.version } : d));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
        setConflictError(true);
      } else {
        setMutError(msg);
      }
    }
  }

  // ── Status change ──────────────────────────────────────────────────────────

  async function changeStatus(status: DocumentStatus) {
    if (!openDoc) return;
    try {
      const updated = await updateDocument(openDoc.id, { status, body: editorValue, version: currentVersionRef.current });
      setOpenDoc(updated);
      currentVersionRef.current = updated.version;
      setDocs((prev) => prev.map((d) => d.id === updated.id ? { ...d, status: updated.status, version: updated.version } : d));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
        setConflictError(true);
      } else {
        setMutError(msg);
      }
    }
  }

  // ── Metadata change (DocCover / RTMView / ADRVotingPanel) ─────────────────

  const handleMetadataChange = useCallback(async (meta: Record<string, unknown>) => {
    if (!openDoc) return;
    try {
      const updated = await updateDocument(openDoc.id, {
        metadata: meta,
        version: currentVersionRef.current,
      });
      setOpenDoc(updated);
      currentVersionRef.current = updated.version;
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes("409") || msg.toLowerCase().includes("conflict")) {
        setConflictError(true);
      }
    }
  }, [openDoc]);

  // ── Comments ───────────────────────────────────────────────────────────────

  async function openComments() {
    if (!selectedDocId) return;
    setShowComments(true);
    try {
      const cs = await listComments(selectedDocId);
      setComments(cs);
    } catch {
      // non-fatal
    }
  }

  async function submitComment() {
    if (!selectedDocId || !newComment.trim()) return;
    setCommentsBusy(true);
    try {
      const c = await createComment(selectedDocId, newComment.trim(), replyTo ?? undefined);
      setComments((prev) => [...prev, c]);
      setNewComment("");
      setReplyTo(null);
    } catch (e) {
      setMutError((e as Error).message);
    } finally {
      setCommentsBusy(false);
    }
  }

  async function handleResolve(commentId: string) {
    try {
      await resolveComment(commentId);
      setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, resolvedAt: new Date().toISOString() } : c));
    } catch {
      // non-fatal
    }
  }

  async function handleDeleteComment(commentId: string) {
    try {
      await deleteComment(commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      // non-fatal
    }
  }

  // ── Versions ───────────────────────────────────────────────────────────────

  async function openVersionHistory() {
    if (!selectedDocId) return;
    setShowVersions(true);
    try {
      const vs = await listVersions(selectedDocId);
      setVersions(vs.sort((a, b) => b.rev - a.rev));
    } catch {
      // non-fatal
    }
  }

  async function previewRev(rev: number) {
    if (!selectedDocId) return;
    try {
      const v = await getVersion(selectedDocId, rev);
      setPreviewVersion(v);
    } catch {
      // non-fatal
    }
  }

  async function doRestore() {
    if (!previewVersion || !openDoc) return;
    setRestoringVersion(true);
    try {
      const updated = await restoreVersion(openDoc.id, previewVersion.rev, currentVersionRef.current);
      setOpenDoc(updated);
      setEditorValue(updated.body ?? EMPTY_DOC);
      currentVersionRef.current = updated.version;
      setPreviewVersion(null);
      setShowVersions(false);
      setDirty(false);
    } catch (e) {
      setMutError((e as Error).message);
    } finally {
      setRestoringVersion(false);
    }
  }

  // ── Delete document ────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!openDoc) return;
    try {
      await deleteDocument(openDoc.id, currentVersionRef.current);
      setSelectedDocId(null);
      setOpenDoc(null);
      setDocs((prev) => prev.filter((d) => d.id !== openDoc.id));
      setShowDeleteDialog(false);
    } catch (e) {
      setMutError((e as Error).message);
      setShowDeleteDialog(false);
    }
  }

  // ── Filtered doc list ──────────────────────────────────────────────────────

  const filteredDocs = docs.filter((d) => {
    const matchesType = typeFilter ? d.type === typeFilter : true;
    const matchesQ = q ? d.title.toLowerCase().includes(q.toLowerCase()) : true;
    return matchesType && matchesQ;
  });

  // Group by type
  const groupedDocs = allowedTypes.reduce<Record<string, DocSummary[]>>((acc, t) => {
    const items = filteredDocs.filter((d) => d.type === t);
    if (items.length > 0) acc[t] = items;
    return acc;
  }, {});

  const commentCount = comments.filter((c) => !c.resolvedAt).length;

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-pulse text-sm text-ink-3">Loading workspace…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-danger">{loadError}</p>
        <Button variant="secondary" onClick={bootstrap}>
          <RefreshCw size={14} /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {/* ── Mutation error bar ──────────────────────────────────────────────── */}
      {mutError && (
        <div className="flex items-center gap-2 border-b border-danger/30 bg-danger/5 px-4 py-1.5 font-mono text-[11px] text-danger">
          <span className="flex-1">{mutError}</span>
          <button type="button" onClick={() => setMutError(null)} className="text-danger/60 hover:text-danger">×</button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
      {/* ── Left rail: doc list ─────────────────────────────────────────────── */}
      <div className="flex w-60 shrink-0 flex-col border-r border-line bg-surface-2">
        {/* Search */}
        <div className="flex items-center gap-1 border-b border-line p-2">
          <div className="relative flex-1">
            <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              className="h-7 w-full rounded-xs border border-line bg-surface pl-6 pr-2 text-[12px] text-ink focus:border-accent focus:outline-none"
              placeholder="Search docs…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button
            variant="primary"
            size="sm"
            aria-label="New document"
            onClick={() => setShowNewDocDialog(true)}
          >
            <Plus size={13} />
          </Button>
        </div>

        {/* Type filter chips */}
        <div className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5">
          <button
            type="button"
            onClick={() => setTypeFilter("")}
            className={`h-5 rounded-xs px-2 text-[11px] font-medium transition-colors ${typeFilter === "" ? "bg-accent text-surface" : "text-ink-3 hover:text-ink"}`}
          >
            All
          </button>
          {allowedTypes.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTypeFilter(typeFilter === t ? "" : t)}
              className={`h-5 rounded-xs px-2 text-[11px] font-medium transition-colors ${typeFilter === t ? "bg-accent text-surface" : "text-ink-3 hover:text-ink"}`}
            >
              {typeLabel(t, kind)}
            </button>
          ))}
        </div>

        {/* Doc list */}
        <div className="flex-1 overflow-auto">
          {Object.entries(groupedDocs).length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="text-[12px] text-ink-3">No documents yet.</p>
              <Button variant="ghost" size="sm" onClick={() => setShowNewDocDialog(true)}>
                <Plus size={12} /> New
              </Button>
            </div>
          ) : (
            Object.entries(groupedDocs).map(([type, items]) => (
              <div key={type}>
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-ink-3">
                  {typeLabel(type as DocumentType, kind)}
                </div>
                {items.map((doc) => (
                  <button
                    type="button"
                    key={doc.id}
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`flex w-full flex-col gap-0.5 px-2 py-1.5 text-left transition-colors ${
                      selectedDocId === doc.id
                        ? "bg-accent-soft"
                        : "hover:bg-surface"
                    }`}
                  >
                    <span className="truncate text-[13px] font-medium text-ink">{doc.title}</span>
                    <div className="flex items-center gap-1">
                      <Tag tone={statusTone(doc.status)} dot>
                        {doc.status}
                      </Tag>
                      <span className="ml-auto font-mono text-[10px] text-ink-3">
                        {relativeTime(doc.updatedAt)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Right pane: editor ──────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {openDoc ? (
          <>
            {/* Document header */}
            <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-2">
              {renaming ? (
                <input
                  autoFocus
                  aria-label="Document title"
                  title="Document title"
                  className="flex-1 rounded-xs border border-accent bg-surface px-2 py-1 text-base font-semibold text-ink focus:outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void commitRename(); }
                    if (e.key === "Escape") { setRenaming(false); }
                  }}
                />
              ) : (
                <h2
                  className="flex-1 cursor-pointer truncate text-base font-semibold text-ink hover:text-accent"
                  title="Click to rename"
                  onClick={() => { setRenaming(true); setRenameValue(openDoc.title); }}
                >
                  {openDoc.title}
                </h2>
              )}

              <Tag tone="neutral">{typeLabel(openDoc.type, kind)}</Tag>

              <select
                aria-label="Status"
                className="h-7 appearance-none rounded-xs border border-line bg-surface px-2 text-[12px] text-ink focus:border-accent focus:outline-none"
                value={openDoc.status}
                onChange={(e) => void changeStatus(e.target.value as DocumentStatus)}
              >
                {(["draft", "review", "approved", "archived"] as DocumentStatus[]).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>

              <SaveTag status={saving} />

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  title="Version history"
                  onClick={() => void openVersionHistory()}
                >
                  <History size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title="Delete document"
                  onClick={() => setShowDeleteDialog(true)}
                >
                  <Trash2 size={14} className="text-danger" />
                </Button>
              </div>
            </div>

            {/* Conflict error banner */}
            {conflictError && (
              <div className="flex items-center gap-3 border-b border-warning/30 bg-warning/5 px-4 py-1.5 text-[12px]">
                <span className="font-medium text-warning">Conflict:</span>
                Document was modified elsewhere.
                <Button variant="ghost" size="sm" onClick={() => void loadDoc(openDoc.id)}>
                  Reload
                </Button>
              </div>
            )}

            {/* Editor area with type-specific panels */}
            <div className="min-h-0 flex-1 overflow-auto bg-paper flex flex-col">
              {/* Cover panel — all types except rtm */}
              {openDoc.type !== "rtm" && (
                <DocCover doc={openDoc} onMetadataChange={handleMetadataChange} />
              )}
              {/* RTM gets its own full view */}
              {openDoc.type === "rtm" ? (
                <RTMView doc={openDoc} onMetadataChange={handleMetadataChange} />
              ) : (
                <DocEditor value={editorValue} onChange={onEditorChange} />
              )}
              {/* ADR voting below editor */}
              {openDoc.type === "adr" && (
                <ADRVotingPanel
                  doc={openDoc}
                  onMetadataChange={handleMetadataChange}
                  onStatusChange={(s) => void changeStatus(s)}
                />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t border-line bg-paper px-4 py-1.5 text-[11px] text-ink-3">
              <span className="font-mono">v{openDoc.version}</span>
              <span>·</span>
              <span>{relativeTime(openDoc.updatedAt)}</span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { if (dirty) void doSave(editorValue); }}
                  disabled={!dirty || saving === "saving"}
                >
                  Save
                </Button>
              </div>
            </div>
          </>
        ) : (
          <WorkspaceDashboard
            kind={kind}
            docs={docs}
            allowedTypes={allowedTypes}
            onSelectDoc={(id) => setSelectedDocId(id)}
            onNewDoc={(type) => {
              setInitialDocType(type);
              setShowNewDocDialog(true);
            }}
          />
        )}
      </div>

      {/* ── Floating comment toggle ─────────────────────────────────────────── */}
      {selectedDocId && (
        <button
          type="button"
          aria-label="Toggle comments"
          onClick={() => (showComments ? setShowComments(false) : void openComments())}
          className="fixed bottom-6 right-6 z-30 flex h-11 w-11 items-center justify-center rounded-full bg-accent text-surface shadow-pop hover:bg-accent-hover"
        >
          <MessageCircle size={18} />
          {commentCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-0.5 text-[9px] font-bold text-surface">
              {commentCount}
            </span>
          )}
        </button>
      )}

      {/* ── Comments panel ──────────────────────────────────────────────────── */}
      {showComments && (
        <div className="flex w-72 shrink-0 flex-col border-l border-line bg-surface shadow-sm">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[13px] font-semibold text-ink">Comments</span>
            <button type="button" title="Close comments" aria-label="Close comments" onClick={() => setShowComments(false)} className="text-ink-3 hover:text-ink">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-3 space-y-3">
            {comments.length === 0 ? (
              <p className="text-[12px] text-ink-3">No comments yet.</p>
            ) : (
              comments
                .filter((c) => !c.parentId)
                .map((c) => (
                  <div key={c.id} className={`rounded-sm border p-2 text-[12px] ${c.resolvedAt ? "border-line/50 opacity-60" : "border-line"}`}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent-soft text-[9px] font-mono font-semibold text-ink-2">
                        {authorInitials(c.authorId)}
                      </span>
                      <span className="text-[10px] text-ink-3">{relativeTime(c.createdAt)}</span>
                      {c.resolvedAt && <span className="ml-auto text-[10px] text-success">Resolved</span>}
                    </div>
                    <p className="text-ink-2">{c.body}</p>

                    {/* Replies */}
                    {comments
                      .filter((r) => r.parentId === c.id)
                      .map((r) => (
                        <div key={r.id} className="ml-4 mt-1.5 border-l-2 border-line pl-2">
                          <div className="mb-0.5 flex items-center gap-1">
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent-soft text-[8px] font-mono text-ink-2">
                              {authorInitials(r.authorId)}
                            </span>
                            <span className="text-[10px] text-ink-3">{relativeTime(r.createdAt)}</span>
                          </div>
                          <p className="text-[12px] text-ink-2">{r.body}</p>
                        </div>
                      ))}

                    {!c.resolvedAt && (
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          className="text-[10px] text-ink-3 hover:text-accent"
                          onClick={() => setReplyTo(c.id)}
                        >
                          Reply
                        </button>
                        <button
                          type="button"
                          className="text-[10px] text-ink-3 hover:text-success"
                          onClick={() => void handleResolve(c.id)}
                        >
                          Resolve
                        </button>
                        <button
                          type="button"
                          className="text-[10px] text-ink-3 hover:text-danger"
                          onClick={() => void handleDeleteComment(c.id)}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))
            )}
          </div>

          {/* New comment input */}
          <div className="border-t border-line p-3 space-y-2">
            {replyTo && (
              <div className="flex items-center gap-1 text-[11px] text-ink-3">
                Replying…
                <button type="button" title="Cancel reply" aria-label="Cancel reply" className="ml-auto hover:text-ink" onClick={() => setReplyTo(null)}>
                  <X size={11} />
                </button>
              </div>
            )}
            <textarea
              className="h-20 w-full resize-none rounded-xs border border-line bg-surface-2 p-2 text-[12px] text-ink focus:border-accent focus:outline-none"
              placeholder="Add a comment…"
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                variant="primary"
                size="sm"
                disabled={!newComment.trim() || commentsBusy}
                onClick={() => void submitComment()}
              >
                Post
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Version history dialog ───────────────────────────────────────────── */}
      {showVersions && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm"
          onClick={() => { setShowVersions(false); setPreviewVersion(null); }}
        >
          <div
            className="flex h-[80vh] w-full max-w-3xl flex-col rounded-md border border-line bg-surface shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h3 className="text-base font-semibold text-ink">Version History</h3>
              <button type="button" title="Close version history" aria-label="Close version history" onClick={() => { setShowVersions(false); setPreviewVersion(null); }} className="text-ink-3 hover:text-ink">
                <X size={16} />
              </button>
            </div>

            <div className="flex min-h-0 flex-1">
              {/* Version list */}
              <div className="w-56 shrink-0 overflow-auto border-r border-line p-2 space-y-1">
                {versions.map((v) => (
                  <button
                    type="button"
                    key={v.id}
                    onClick={() => void previewRev(v.rev)}
                    className={`flex w-full flex-col rounded-xs px-2 py-1.5 text-left text-[12px] transition-colors ${
                      previewVersion?.rev === v.rev ? "bg-accent-soft" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className="font-semibold text-ink">
                      v{v.rev}
                      {v.rev === openDoc?.version && <span className="ml-1 text-[10px] text-success">(current)</span>}
                    </span>
                    <span className="text-ink-3">{relativeTime(v.createdAt)}</span>
                  </button>
                ))}
              </div>

              {/* Preview */}
              <div className="flex min-w-0 flex-1 flex-col">
                {previewVersion ? (
                  <>
                    <div className="flex-1 overflow-auto">
                      <DocEditor value={previewVersion.body} onChange={() => {}} readOnly />
                    </div>
                    <div className="border-t border-line p-3 flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={restoringVersion}
                        onClick={() => void doRestore()}
                      >
                        {restoringVersion ? "Restoring…" : "Restore this version"}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-ink-3">
                    Select a version to preview.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── New document dialog ──────────────────────────────────────────────── */}
      {showNewDocDialog && workspace && (
        <NewDocDialog
          workspace={workspace}
          projectId={projectId}
          kind={kind}
          allowedTypes={allowedTypes}
          initialType={initialDocType}
          onClose={() => { setShowNewDocDialog(false); setInitialDocType(undefined); }}
          onCreated={(doc) => {
            setDocs((prev) => [doc, ...prev]);
            setSelectedDocId(doc.id);
            setShowNewDocDialog(false);
            setInitialDocType(undefined);
          }}
        />
      )}

      {/* ── Delete document dialog ───────────────────────────────────────────── */}
      {showDeleteDialog && openDoc && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm"
          onClick={() => setShowDeleteDialog(false)}
        >
          <div
            className="w-full max-w-md rounded-md border border-line bg-surface p-5 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-3 text-base font-semibold text-ink">Delete document</h2>
            <p className="mb-4 text-sm text-ink-2">
              Delete <span className="font-semibold">{openDoc.title}</span>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowDeleteDialog(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => void handleDelete()}>Delete</Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// ─── New Document Dialog ──────────────────────────────────────────────────────

interface NewDocDialogProps {
  workspace: Workspace;
  projectId: string;
  kind: WorkspaceKind;
  allowedTypes: DocumentType[];
  initialType?: DocumentType;
  onClose: () => void;
  onCreated: (doc: Document) => void;
}

function NewDocDialog({ workspace, projectId, kind, allowedTypes, initialType, onClose, onCreated }: NewDocDialogProps) {
  const [tab, setTab] = useState<"template" | "blank">("template");
  const [selectedType, setSelectedType] = useState<DocumentType>(initialType ?? allowedTypes[0]);
  const [title, setTitle] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    listTemplates().then((ts) => {
      const relevant = ts.filter((t) => (allowedTypes as string[]).includes(t.type));
      setTemplates(relevant);
    }).catch(() => {});
  }, [allowedTypes]);

  async function create() {
    if (!title.trim()) { setErr("Title is required."); return; }
    setBusy(true);
    setErr(null);
    try {
      const doc = await createDocument({
        workspace_id: workspace.id,
        project_id: projectId,
        type: selectedType,
        title: title.trim(),
        body: selectedTemplate?.body ?? EMPTY_DOC,
      });
      onCreated(doc);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const typeOptions = TYPES_BY_KIND[kind] ?? [];
  const filteredTemplates = templates.filter((t) => t.type === selectedType);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-md border border-line bg-surface p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">New Document</h2>
          <button type="button" title="Close" aria-label="Close" onClick={onClose} className="text-ink-3 hover:text-ink"><X size={16} /></button>
        </div>

        {/* Tabs */}
        <div className="mb-4 flex gap-0 border-b border-line">
          {(["template", "blank"] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-medium transition-colors ${
                tab === t ? "border-accent text-ink" : "border-transparent text-ink-3 hover:text-ink-2"
              }`}
            >
              {t === "template" ? "From Template" : "Blank"}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          {/* Type selector (shared) */}
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Type</span>
            <select
              aria-label="Document type"
              className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none"
              value={selectedType}
              onChange={(e) => { setSelectedType(e.target.value as DocumentType); setSelectedTemplate(null); }}
            >
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {/* Template picker */}
          {tab === "template" && (
            <div>
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Template</span>
              {filteredTemplates.length === 0 ? (
                <p className="text-[12px] text-ink-3">No templates for this type. Use Blank tab.</p>
              ) : (
                <div className="space-y-1 max-h-40 overflow-auto">
                  {filteredTemplates.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => setSelectedTemplate(t)}
                      className={`flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-left text-[12px] transition-colors ${
                        selectedTemplate?.id === t.id ? "bg-accent-soft font-medium text-ink" : "hover:bg-surface-2 text-ink-2"
                      }`}
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Title */}
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">Title <span className="text-signal">*</span></span>
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Document title…"
              onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
            />
          </label>

          {err && (
            <div className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!title.trim() || busy} loading={busy} onClick={() => void create()}>
              Create
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
