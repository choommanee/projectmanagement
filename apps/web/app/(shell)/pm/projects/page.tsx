"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  RefreshCw,
  Download,
  Eye,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listProjects,
  createProject,
  deleteProject,
  type Project,
} from "@/lib/api/projects";

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

type StatusFilter = "" | "planning" | "active" | "on_hold" | "completed" | "cancelled";

function statusTone(s: Project["status"]): "success" | "warning" | "neutral" | "signal" {
  switch (s) {
    case "active": return "success";
    case "on_hold": return "warning";
    case "completed": return "neutral";
    case "cancelled": return "signal";
    default: return "neutral";
  }
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  // Use <progress> — semantic, no inline styles needed; styled via globals.css .progress-bar
  return (
    <div className="flex items-center gap-2">
      <progress className="progress-bar" value={pct} max={100} aria-label={`${pct}%`} />
      <span className="font-mono text-[11px] tabular-nums text-ink-3">{pct}%</span>
    </div>
  );
}

function OwnerAvatar({ ownerId }: { ownerId?: string | null }) {
  if (!ownerId) {
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-line text-[10px] text-ink-3">
        —
      </span>
    );
  }
  const short = ownerId.slice(-6);
  return (
    <span
      className="inline-flex h-6 items-center justify-center rounded-full bg-accent-soft px-1.5 font-mono text-[9px] text-ink-2"
      title={ownerId}
    >
      {short}
    </span>
  );
}

export default function ProjectsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listProjects({
        q: q || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [q, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keyboard shortcut: N to open create
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setShowCreate(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function exportCsv() {
    const headers = ["Code", "Name", "Status", "Progress", "Start", "Due", "Updated", "Version"];
    const rows = items.map((p) => [
      p.code,
      `"${p.name.replace(/"/g, '""')}"`,
      p.status,
      p.progressPct,
      p.startDate ?? "",
      p.dueDate ?? "",
      p.updatedAt?.slice(0, 10) ?? "",
      p.version,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const a = document.createElement("a");
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
    a.download = `projects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[{ label: "Home", href: "/pm/home" }, { label: "Projects" }]}
      />
      <CommandBar
        actions={[
          {
            id: "new",
            label: "New Project",
            variant: "primary",
            icon: <Plus size={14} />,
            onClick: () => setShowCreate(true),
          },
          { kind: "separator", id: "s1" },
          {
            id: "ref",
            label: "Refresh",
            variant: "ghost",
            icon: <RefreshCw size={14} />,
            onClick: load,
          },
          {
            id: "exp",
            label: "Export CSV",
            variant: "ghost",
            icon: <Download size={14} />,
            onClick: exportCsv,
          },
        ]}
      />

      {/* Toolbar: status filters + search */}
      <div className="flex items-center gap-2 border-b border-line bg-paper px-3 py-2">
        <div className="flex gap-1">
          {STATUS_OPTIONS.map((s) => (
            <button
              type="button"
              key={s.value || "all"}
              onClick={() => {
                setStatus(s.value as StatusFilter);
                setPage(0);
              }}
              className={`h-7 rounded-xs px-2.5 text-[12px] font-medium transition-colors ${
                status === s.value
                  ? "bg-surface-2 text-ink"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-72">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3"
          />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Search code or name…"
            className="pl-8"
          />
        </div>
      </div>

      {error && (
        <div className="border-b border-danger/30 bg-danger/5 px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr>
              {[
                "Code",
                "Name",
                "Status",
                "Owner",
                "Progress",
                "Start",
                "Due",
                "Updated",
                "v",
                "",
              ].map((h) => (
                <th
                  key={h}
                  className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-3 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-8 text-center text-sm text-ink-3"
                >
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-3 py-12 text-center text-sm text-ink-3"
                >
                  No projects found. Press{" "}
                  <kbd className="rounded-xs border border-line px-1 font-mono text-[11px]">
                    N
                  </kbd>{" "}
                  to create one.
                </td>
              </tr>
            ) : (
              items.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-line/60 transition-colors hover:bg-accent-soft cursor-pointer"
                  onClick={() => router.push(`/pm/projects/${p.id}`)}
                >
                  <td className="px-3 py-2 font-mono text-[12px] text-ink whitespace-nowrap">
                    {p.code}
                  </td>
                  <td className="px-3 py-2 text-ink max-w-70 truncate">
                    {p.name}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Tag tone={statusTone(p.status)} dot>
                      {p.status.replace("_", " ")}
                    </Tag>
                  </td>
                  <td className="px-3 py-2">
                    <OwnerAvatar ownerId={p.ownerId} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <ProgressBar value={p.progressPct} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-ink-3 tabular-nums whitespace-nowrap">
                    {p.startDate?.slice(0, 10) ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-ink-3 tabular-nums whitespace-nowrap">
                    {p.dueDate?.slice(0, 10) ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-ink-3 tabular-nums whitespace-nowrap">
                    {p.updatedAt?.slice(0, 16).replace("T", " ") ?? ""}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-ink-3 tabular-nums">
                    v{p.version}
                  </td>
                  <td
                    className="px-3 py-2 text-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="inline-flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="View"
                        onClick={() => router.push(`/pm/projects/${p.id}`)}
                      >
                        <Eye size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Edit"
                        onClick={() => router.push(`/pm/projects/${p.id}`)}
                      >
                        <Pencil size={13} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label="Delete"
                        onClick={() => setDeleteTarget(p)}
                      >
                        <Trash2 size={13} className="text-danger" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between border-t border-line bg-paper px-3 py-2 text-[12px] text-ink-3">
        <span className="font-mono tabular-nums">
          {total} project{total !== 1 ? "s" : ""} • page {page + 1} of{" "}
          {totalPages}
        </span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={(page + 1) * PAGE_SIZE >= total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {showCreate && (
        <CreateDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}

      {deleteTarget && (
        <DeleteDialog
          project={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

// ─── Create Dialog ──────────────────────────────────────────────────────────

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Project["status"]>("planning");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = code.trim().length > 0 && name.trim().length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      await createProject({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        status,
      });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title="Create Project" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Code" required>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="PRJ-001"
            className="font-mono"
            autoFocus
          />
          <p className="mt-1 text-[11px] text-ink-3">
            Short uppercase identifier (e.g. PHXM, WEB-2)
          </p>
        </Field>
        <Field label="Name" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Phoenix Migration"
          />
        </Field>
        <Field label="Description">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description…"
          />
        </Field>
        <Field label="Status">
          <SelectNative
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as Project["status"])}
            options={["planning", "active", "on_hold", "completed", "cancelled"]}
          />
        </Field>
        {err && (
          <div className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
            {err}
          </div>
        )}
        <DialogActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!canSubmit}
            loading={busy}
          >
            Create
          </Button>
        </DialogActions>
      </form>
    </DialogShell>
  );
}

// ─── Delete Dialog ──────────────────────────────────────────────────────────

function DeleteDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: Project;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await deleteProject(project.id, project.version);
      onDeleted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title="Delete project" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          This will delete{" "}
          <span className="font-mono font-semibold text-ink">{project.code}</span>{" "}
          — {project.name}. This action cannot be undone.
        </p>
        <Field label={`Type ${project.code} to confirm`}>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="font-mono"
            placeholder={project.code}
          />
        </Field>
        {err && (
          <div className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
            {err}
          </div>
        )}
        <DialogActions>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={confirm !== project.code || busy}
            loading={busy}
            onClick={submit}
          >
            Delete project
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  );
}

// ─── Shared atoms ────────────────────────────────────────────────────────────

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-label={title}
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-md border border-line bg-surface p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold text-ink">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function DialogActions({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 flex justify-end gap-2">{children}</div>;
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {label}
        {required && <span className="ml-0.5 text-signal">*</span>}
      </span>
      {children}
    </label>
  );
}

function SelectNative<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (v: T) => void;
  options: readonly T[];
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace("_", " ")}
        </option>
      ))}
    </select>
  );
}
