"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, Trash2, Workflow } from "lucide-react";
import { Button, Input, Tag, TextArea } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listWorkflows,
  createWorkflow,
  deleteWorkflow,
  type WorkflowDef,
  type WorkflowStatus,
} from "@/lib/api/workflows";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusTone(s: WorkflowStatus): "neutral" | "info" | "danger" | "success" {
  if (s === "published") return "success";
  if (s === "archived") return "danger";
  return "neutral";
}

const STATUS_FILTERS: { value: WorkflowStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

// ─── Create dialog ────────────────────────────────────────────────────────────

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (wf: WorkflowDef) => void;
}

function CreateDialog({ open, onClose, onCreated }: CreateDialogProps) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) { setError("Name is required"); return; }
    setLoading(true);
    setError(null);
    try {
      const wf = await createWorkflow({ name: name.trim(), description: desc.trim() });
      onCreated(wf);
      setName("");
      setDesc("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-lg border border-line bg-paper shadow-xl">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">New Workflow</h2>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Invoice Approval"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Description</label>
            <TextArea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional description…"
              rows={3}
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading}>
            {loading ? "Creating…" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const router = useRouter();
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | "">("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WorkflowDef | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { items, total: t } = await listWorkflows({
        q: q || undefined,
        status: statusFilter || undefined,
        limit: 100,
      });
      setWorkflows(items);
      setTotal(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleCreated = (wf: WorkflowDef) => {
    setWorkflows((prev) => [wf, ...prev]);
    setTotal((t) => t + 1);
    router.push(`/pm/workflows/${wf.id}`);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteWorkflow(deleteTarget.id, deleteTarget.version);
      setWorkflows((prev) => prev.filter((w) => w.id !== deleteTarget.id));
      setTotal((t) => t - 1);
      setDeleteTarget(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Workflows" }]} />
      <CommandBar
        actions={[
          {
            id: "new",
            label: "New Workflow",
            icon: <Plus size={14} />,
            variant: "primary",
            onClick: () => setShowCreate(true),
          },
          {
            id: "refresh",
            label: "Refresh",
            icon: <RefreshCw size={14} />,
            onClick: load,
          },
        ]}
      />

      <div className="flex flex-1 flex-col overflow-auto p-4">
        {/* Search + filter */}
        <div className="mb-4 flex items-center gap-3">
          <Input
            placeholder="Search workflows…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="max-w-xs"
          />
          <div className="flex items-center gap-1">
            {STATUS_FILTERS.map((f) => (
              <button
                type="button"
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors
                  ${statusFilter === f.value
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-ink-2 hover:bg-surface hover:text-ink"
                  }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-ink-3">{total} workflows</span>
        </div>

        {loading && (
          <div className="flex flex-1 items-center justify-center text-sm text-ink-3">Loading…</div>
        )}
        {error && (
          <div className="mb-3 rounded-md border border-danger bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>
        )}

        {!loading && (
          <div className="overflow-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-center">Version</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2 text-left">Updated</th>
                  <th className="px-2 py-2" scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {workflows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-ink-3">
                      <Workflow size={32} className="mx-auto mb-2 opacity-30" />
                      <p>No workflows yet. Create your first one.</p>
                    </td>
                  </tr>
                )}
                {workflows.map((wf) => (
                  <tr
                    key={wf.id}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-surface-2"
                    onClick={() => router.push(`/pm/workflows/${wf.id}`)}
                  >
                    <td className="px-4 py-2.5 font-medium text-ink">{wf.name}</td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-ink-2">{wf.description || "—"}</td>
                    <td className="px-4 py-2.5">
                      <Tag tone={statusTone(wf.status)}>{wf.status}</Tag>
                    </td>
                    <td className="px-4 py-2.5 text-center font-mono text-xs text-ink-2">v{wf.currentVersion}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-3">{fmtDate(wf.createdAt)}</td>
                    <td className="px-4 py-2.5 text-xs text-ink-3">{fmtDate(wf.updatedAt)}</td>
                    <td className="px-2 py-2.5">
                      <button
                        type="button"
                        title="Delete"
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget(wf); }}
                        className="rounded p-1 text-ink-3 hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={handleCreated}
      />

      {/* Delete confirm */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-sm rounded-lg border border-line bg-paper p-6 shadow-xl">
            <h2 className="mb-2 text-sm font-semibold text-ink">Delete Workflow</h2>
            <p className="mb-4 text-sm text-ink-2">
              Delete <strong>&ldquo;{deleteTarget.name}&rdquo;</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
