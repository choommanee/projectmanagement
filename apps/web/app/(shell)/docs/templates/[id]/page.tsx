"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button, Dialog, Input } from "@pmplatform/ui-kit";
import { DocEditor } from "@/components/DocEditor";
import {
  getTemplate, listAllWorkspaces, instantiateTemplate, deleteTemplate,
  type Template, type Workspace,
} from "@/lib/api/documents";
import { TemplateEditorDialog, type TemplateEditorMode } from "../TemplateEditorDialog";

function InstantiateDialog({
  open, tmpl, workspaces, onClose, onCreated,
}: {
  open: boolean;
  tmpl: Template;
  workspaces: Workspace[];
  onClose: () => void;
  onCreated: (docId: string) => void;
}) {
  const [title, setTitle] = useState(tmpl.name);
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaces.length > 0 && !workspaceId) setWorkspaceId(workspaces[0].id);
  }, [workspaces, workspaceId]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!title.trim() || !ws) { setError("Title and workspace are required."); return; }
    setLoading(true); setError(null);
    try {
      const doc = await instantiateTemplate(tmpl, {
        workspace_id: ws.id,
        project_id: ws.projectId,
        title: title.trim(),
      });
      onCreated(doc.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create document");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create Document from Template">
      <form onSubmit={submit} className="space-y-4 p-4">
        {error && (
          <div className="rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">{error}</div>
        )}
        <div className="space-y-1">
          <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1">
          <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-3">Workspace</label>
          {workspaces.length === 0 ? (
            <p className="font-mono text-[11px] text-ink-3">No workspaces available. Create a project first.</p>
          ) : (
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {workspaces.map(w => (
                <option key={w.id} value={w.id}>{w.name} ({w.kind})</option>
              ))}
            </select>
          )}
        </div>
        <p className="font-mono text-[10px] text-ink-3">
          Type: {tmpl.type?.replace(/_/g, " ")} · the template structure is copied into a fresh draft.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={loading || workspaces.length === 0}>
            {loading ? "Creating…" : "Create Document"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tmpl, setTmpl] = useState<Template | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editorMode, setEditorMode] = useState<TemplateEditorMode | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function load() {
    if (!id) return;
    Promise.all([
      getTemplate(id),
      listAllWorkspaces({ limit: 200 }).then(r => r.items).catch(() => [] as Workspace[]),
    ])
      .then(([t, ws]) => { setTmpl(t); setWorkspaces(ws); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  async function handleDelete() {
    if (!tmpl) return;
    if (!confirm(`Delete template "${tmpl.name}"? This cannot be undone.`)) return;
    setDeleting(true); setActionError(null);
    try {
      await deleteTemplate(tmpl.id);
      router.push("/docs/templates");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete template");
      setDeleting(false);
    }
  }

  if (loading) return <div className="p-8 text-ink-3">Loading...</div>;
  if (!tmpl) return <div className="p-8 text-danger">Template not found.</div>;

  const hasBody = !!tmpl.body && Object.keys(tmpl.body).length > 0;

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-ink-3">
        <button onClick={() => router.push("/docs/templates")} className="hover:underline">Templates</button>
        <span className="mx-2">/</span>
        <span>{tmpl.name}</span>
      </nav>

      <div className="rounded-lg border border-line bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{tmpl.name}</h1>
            <p className="text-sm text-ink-3 mt-1 capitalize">{tmpl.type?.replace(/_/g, " ")}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {tmpl.isSystem && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-info/10 text-info">System</span>
            )}
            <Button variant="ghost" onClick={() => setEditorMode("duplicate")}>Duplicate</Button>
            {!tmpl.isSystem && (
              <>
                <Button variant="ghost" onClick={() => setEditorMode("edit")}>Edit</Button>
                <Button variant="ghost" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete"}
                </Button>
              </>
            )}
            <Button variant="primary" onClick={() => setShowCreate(true)}>Use this template</Button>
          </div>
        </div>
        {actionError && (
          <div className="mt-3 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">{actionError}</div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Type", value: tmpl.type?.replace(/_/g, " ") ?? "—" },
          { label: "System Template", value: tmpl.isSystem ? "Yes" : "No" },
          { label: "Created", value: tmpl.createdAt ? tmpl.createdAt.slice(0, 10) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-line bg-card p-4">
            <p className="text-xs text-ink-3 uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-medium capitalize">{value}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-line bg-card overflow-hidden">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3 px-6 pt-6 pb-2">Template Preview</h2>
        {hasBody ? (
          <DocEditor value={tmpl.body} onChange={() => {}} readOnly />
        ) : (
          <p className="px-6 pb-6 text-sm text-ink-3">This template has no content yet. Use Edit to add structure.</p>
        )}
      </div>

      <InstantiateDialog
        open={showCreate}
        tmpl={tmpl}
        workspaces={workspaces}
        onClose={() => setShowCreate(false)}
        onCreated={(docId) => { setShowCreate(false); router.push("/docs/documents/" + docId); }}
      />

      <TemplateEditorDialog
        open={editorMode !== null}
        mode={editorMode ?? "edit"}
        source={tmpl}
        onClose={() => setEditorMode(null)}
        onSaved={(saved) => {
          const wasDuplicate = editorMode === "duplicate";
          setEditorMode(null);
          if (wasDuplicate) {
            router.push("/docs/templates/" + saved.id);
          } else {
            setTmpl(saved);
          }
        }}
      />
    </div>
  );
}
