"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
import { Button, Input, Tag, Dialog, EmptyState, LoadingState } from "@pmplatform/ui-kit";
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

  // ── KPI strip aggregates (computed client-side from loaded page) ──────────
  const kpis = useMemo(() => {
    const byStatus = { planning: 0, active: 0, on_hold: 0, completed: 0, cancelled: 0 } as Record<string, number>;
    let progSum = 0;
    let overdue = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const p of items) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      progSum += p.progressPct ?? 0;
      if (p.dueDate && p.dueDate.slice(0, 10) < today && p.status !== "completed" && p.status !== "cancelled") {
        overdue++;
      }
    }
    const avgProgress = items.length ? Math.round(progSum / items.length) : 0;
    return { byStatus, avgProgress, overdue };
  }, [items]);

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

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
          {/* ── Editorial header ─────────────────────────────────────────── */}
          <header className="reveal-up flex items-end justify-between gap-6 border-b border-line pb-5">
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
                ◢ control room · portfolio
              </div>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
                Projects
              </h1>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">snapshot · page</div>
              <div className="font-mono text-[11px] tabular-nums text-ink-2">
                {items.length}/{total} · v{page + 1}
              </div>
            </div>
          </header>

          {/* ── Live instrument strip ────────────────────────────────────── */}
          <section
            className="reveal-up relative overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs"
            aria-label="Project portfolio KPIs"
          >
            <div aria-hidden className="pointer-events-none absolute inset-0 blueprint-grid" />
            <div className="relative grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-y divide-line lg:divide-y-0 lg:divide-x">
              {[
                { label: "total",     value: total,                  tone: "accent" as const },
                { label: "planning",  value: kpis.byStatus.planning, tone: "accent" as const },
                { label: "active",    value: kpis.byStatus.active,   tone: "accent" as const },
                { label: "on_hold",   value: kpis.byStatus.on_hold,  tone: "signal" as const },
                { label: "completed", value: kpis.byStatus.completed,tone: "accent" as const },
                { label: "overdue",   value: kpis.overdue,           tone: "signal" as const },
                { label: "avg ▸",     value: `${kpis.avgProgress}%`, tone: "accent" as const },
              ].map((k) => (
                <div key={k.label} className="flex flex-col gap-1 px-4 py-4">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${k.tone === "signal" ? "bg-signal" : "bg-accent"}`} />
                    {k.label}
                  </div>
                  <div className={`font-mono text-[24px] font-semibold leading-none tabular-nums ${k.tone === "signal" && Number(k.value) > 0 ? "text-signal" : "text-ink"}`}>
                    {k.value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Toolbar: status filters + search ─────────────────────────── */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by status">
              {STATUS_OPTIONS.map((s) => (
                <button
                  type="button"
                  key={s.value || "all"}
                  role="tab"
                  aria-selected={status === s.value ? "true" : "false"}
                  onClick={() => {
                    setStatus(s.value as StatusFilter);
                    setPage(0);
                  }}
                  className={`h-7 rounded-xs px-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] transition-colors ${
                    status === s.value
                      ? "bg-ink text-paper"
                      : "border border-line-strong bg-surface text-ink-3 hover:border-accent/40 hover:text-ink"
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
                aria-label="Search projects"
              />
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
              {error}
            </div>
          )}

          {/* ── Table card ─────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead className="bg-paper">
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
                      className="border-b border-line px-3 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-3">
                      <LoadingState rows={3} ariaLabel="Loading projects" />
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="p-4">
                      <EmptyState
                        code="◇ no projects"
                        title="No projects match your filters."
                        description={
                          <>Press <kbd className="rounded-xs border border-line-strong bg-paper px-1 font-mono text-[11px]">N</kbd> to create one — or adjust filters above.</>
                        }
                        action={<Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={13} className="mr-1" />New Project</Button>}
                      />
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
            {/* Pagination footer */}
            <div className="flex items-center justify-between border-t border-line bg-paper px-3 py-2 text-[12px] text-ink-3">
              <span className="font-mono tabular-nums">
                {total} project{total !== 1 ? "s" : ""} · page {page + 1} of {totalPages}
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
          </div>
        </div>
      </div>

      <CreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          void load();
        }}
      />
      <DeleteDialog
        project={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={() => {
          setDeleteTarget(null);
          void load();
        }}
      />
    </div>
  );
}

// ─── Create Dialog ──────────────────────────────────────────────────────────

function CreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
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

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
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
    <Dialog
      open={open}
      onClose={onClose}
      title="Create project"
      description="Short uppercase code · full name · status. Description optional."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>Create</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Code" required>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="PRJ-001"
            className="font-mono"
            data-autofocus
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
          <div role="alert" className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
            {err}
          </div>
        )}
      </form>
    </Dialog>
  );
}

// ─── Delete Dialog ──────────────────────────────────────────────────────────

function DeleteDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: Project | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (project) { setConfirm(""); setErr(null); }
  }, [project]);

  async function submit() {
    if (!project) return;
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
    <Dialog
      open={!!project}
      onClose={onClose}
      title="Delete project"
      description="Irreversible · type the project code to confirm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={!project || confirm !== project.code || busy}
            loading={busy}
            onClick={submit}
          >
            Delete project
          </Button>
        </>
      }
    >
      {project && (
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            This will delete <span className="font-mono font-semibold text-ink">{project.code}</span> — {project.name}. This action cannot be undone.
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
            <div role="alert" className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
              {err}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ─── Shared atoms ────────────────────────────────────────────────────────────

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
      <span className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
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
