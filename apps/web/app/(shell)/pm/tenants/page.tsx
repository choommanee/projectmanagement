"use client";
import { useEffect, useState, useTransition } from "react";
import { Plus, Search, RefreshCw, Trash2, Pencil } from "lucide-react";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { listTenants, createTenant, updateTenant, deleteTenant, type Tenant } from "@/lib/api/tenants";
import { isSlug } from "@/lib/validation";

const TIERS = ["shared", "schema", "dedicated"] as const;
const STATUSES = ["active", "suspended", "archived"] as const;
const REGIONS = ["ap-southeast-1", "ap-southeast-7", "us-east-1", "eu-central-1"] as const;

function statusTone(s: Tenant["status"]): "success" | "warning" | "neutral" {
  if (s === "active") return "success";
  if (s === "suspended") return "warning";
  return "neutral";
}

function tierTone(t: Tenant["tier"]): "neutral" | "info" | "signal" {
  if (t === "shared") return "neutral";
  if (t === "schema") return "info";
  return "signal";
}

export default function TenantsPage() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Tenant[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Tenant | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [, startTransition] = useTransition();
  const [page, setPage] = useState(0);
  const pageSize = 25;

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await listTenants(q, pageSize, page * pageSize);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [q, page]);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Tenants" }]} />
      <CommandBar
        actions={[
          { id: "new", label: "New Tenant", variant: "primary", icon: <Plus size={14} />, onClick: () => setShowCreate(true) },
          { kind: "separator", id: "s1" },
          { id: "ref", label: "Refresh", variant: "ghost", icon: <RefreshCw size={14} />, onClick: () => startTransition(refresh) },
        ]}
      />

      {/* Search bar */}
      <div className="border-b border-line bg-paper px-3 py-2">
        <div className="relative max-w-md">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(0); }}
            placeholder="Search by slug or name…"
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
              {["Slug", "Name", "Tier", "Status", "Region", "Updated", "Version", ""].map((h) => (
                <th key={h} className="border-b border-line px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-ink-3">Loading…</td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-sm text-ink-3">
                  No tenants. Create one to get started.
                </td>
              </tr>
            ) : items.map((t) => (
              <tr key={t.id} className="border-b border-line/60 transition-colors hover:bg-accent-soft">
                <td className="px-3 py-2 font-mono text-[12px] text-ink">{t.slug}</td>
                <td className="px-3 py-2 text-ink">{t.name}</td>
                <td className="px-3 py-2"><Tag tone={tierTone(t.tier)}>{t.tier}</Tag></td>
                <td className="px-3 py-2"><Tag tone={statusTone(t.status)} dot>{t.status}</Tag></td>
                <td className="px-3 py-2 font-mono text-[12px] text-ink-2">{t.region}</td>
                <td className="px-3 py-2 font-mono text-[12px] text-ink-3 tabular-nums">
                  {t.updatedAt?.slice(0, 16).replace("T", " ") ?? ""}
                </td>
                <td className="px-3 py-2 font-mono text-[12px] text-ink-3 tabular-nums">v{t.version}</td>
                <td className="px-3 py-2 text-right">
                  <div className="inline-flex gap-1">
                    <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setEditTarget(t)}>
                      <Pencil size={13} />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label="Delete" onClick={() => setDeleteTarget(t)}>
                      <Trash2 size={13} className="text-danger" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between border-t border-line bg-paper px-3 py-2 text-[12px] text-ink-3">
        <span className="font-mono tabular-nums">
          {total} tenants • page {page + 1} of {Math.max(1, Math.ceil(total / pageSize))}
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            Prev
          </Button>
          <Button variant="ghost" size="sm" disabled={(page + 1) * pageSize >= total} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      {showCreate && (
        <CreateDialog onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refresh(); }} />
      )}
      {editTarget && (
        <EditDialog tenant={editTarget} onClose={() => setEditTarget(null)} onSaved={() => { setEditTarget(null); refresh(); }} />
      )}
      {deleteTarget && (
        <DeleteDialog tenant={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); refresh(); }} />
      )}
    </div>
  );
}

// Create dialog
function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tenant["tier"]>("shared");
  const [region, setRegion] = useState<string>(REGIONS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const slugInvalid = slug.length > 0 && !isSlug(slug);
  const canSubmit = !slugInvalid && slug.length > 0 && name.length > 0 && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      await createTenant({ slug, name, tier, region });
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title="Create tenant" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Slug" required>
          <Input
            value={slug}
            invalid={slugInvalid}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="acme-co"
            className="font-mono"
          />
          {slugInvalid && (
            <p className="mt-1 text-[11px] text-danger">Must be lowercase letters/digits/hyphens, 2-63 chars</p>
          )}
        </Field>
        <Field label="Display Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Co Ltd." />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tier">
            <SelectNative value={tier} onChange={(v) => setTier(v as Tenant["tier"])} options={TIERS} />
          </Field>
          <Field label="Region">
            <SelectNative value={region} onChange={setRegion} options={REGIONS} />
          </Field>
        </div>
        {err && (
          <div className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>
        )}
        <DialogActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!canSubmit} loading={busy}>Create</Button>
        </DialogActions>
      </form>
    </DialogShell>
  );
}

// Edit dialog
function EditDialog({ tenant, onClose, onSaved }: { tenant: Tenant; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tenant.name);
  const [tier, setTier] = useState(tenant.tier);
  const [status, setStatus] = useState(tenant.status);
  const [region, setRegion] = useState(tenant.region);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await updateTenant(tenant.id, { name, tier, status, region, version: tenant.version });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title={`Edit ${tenant.slug}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Slug">
          <Input value={tenant.slug} disabled className="font-mono" />
          <p className="mt-1 text-[11px] text-ink-3">Slug cannot be changed.</p>
        </Field>
        <Field label="Display Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tier">
            <SelectNative value={tier} onChange={(v) => setTier(v as Tenant["tier"])} options={TIERS} />
          </Field>
          <Field label="Status">
            <SelectNative value={status} onChange={(v) => setStatus(v as Tenant["status"])} options={STATUSES} />
          </Field>
        </div>
        <Field label="Region">
          <SelectNative value={region} onChange={setRegion} options={REGIONS} />
        </Field>
        {err && (
          <div className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>
        )}
        <DialogActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Save</Button>
        </DialogActions>
      </form>
    </DialogShell>
  );
}

// Delete confirmation
function DeleteDialog({ tenant, onClose, onDeleted }: { tenant: Tenant; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await deleteTenant(tenant.id, tenant.version);
      onDeleted();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title="Delete tenant" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          This soft-deletes <span className="font-mono text-ink">{tenant.slug}</span>. Data is retained 30 days then purged.
        </p>
        <Field label={`Type ${tenant.slug} to confirm`}>
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="font-mono" />
        </Field>
        {err && (
          <div className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>
        )}
        <DialogActions>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            variant="danger"
            disabled={confirm !== tenant.slug}
            loading={busy}
            onClick={submit}
          >
            Delete tenant
          </Button>
        </DialogActions>
      </div>
    </DialogShell>
  );
}

// Reusable atoms
function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
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

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {label}{required && <span className="ml-0.5 text-signal">*</span>}
      </span>
      {children}
    </label>
  );
}

function SelectNative<T extends string>({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: T) => void;
  options: readonly T[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
