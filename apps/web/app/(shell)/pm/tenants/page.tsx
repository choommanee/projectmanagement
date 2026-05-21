"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Search, RefreshCw, Trash2, Pencil } from "lucide-react";
import { Button, Input, Tag, Dialog, EmptyState, LoadingState } from "@pmplatform/ui-kit";
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

  // ── KPI strip (computed from currently-loaded items) ──────────────────────
  const kpis = useMemo(() => {
    const byStatus = { active: 0, suspended: 0, archived: 0 };
    const byTier = { shared: 0, schema: 0, dedicated: 0 };
    for (const t of items) {
      if (t.status in byStatus) byStatus[t.status as keyof typeof byStatus]++;
      if (t.tier in byTier) byTier[t.tier as keyof typeof byTier]++;
    }
    return { byStatus, byTier };
  }, [items]);

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

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
          {/* ── Editorial header ─────────────────────────────────────────── */}
          <header className="reveal-up flex items-end justify-between gap-6 border-b border-line pb-5">
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
                ◢ control room · tenant administration
              </div>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
                Tenants
              </h1>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">snapshot</div>
              <div className="font-mono text-[11px] tabular-nums text-ink-2">
                {new Date().toISOString().replace("T", " ").slice(0, 19)}Z
              </div>
            </div>
          </header>

          {/* ── Live instrument strip ────────────────────────────────────── */}
          <section
            className="reveal-up relative overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs"
            aria-label="Tenant population KPIs"
          >
            <div aria-hidden className="pointer-events-none absolute inset-0 blueprint-grid" />
            <div className="relative grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-y divide-line lg:divide-y-0 lg:divide-x">
              {[
                { label: "total", value: total, tone: "accent" as const },
                { label: "active",      value: kpis.byStatus.active,    tone: "accent" as const },
                { label: "suspended",   value: kpis.byStatus.suspended, tone: "signal" as const },
                { label: "archived",    value: kpis.byStatus.archived,  tone: "accent" as const },
                { label: "tier·shared", value: kpis.byTier.shared,      tone: "accent" as const },
                { label: "tier·schema", value: kpis.byTier.schema,      tone: "accent" as const },
                { label: "tier·dedi",   value: kpis.byTier.dedicated,   tone: "signal" as const },
              ].map((k) => (
                <div key={k.label} className="flex flex-col gap-1 px-4 py-4">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${k.tone === "signal" ? "bg-signal" : "bg-accent"}`} />
                    {k.label}
                  </div>
                  <div className={`font-mono text-[24px] font-semibold leading-none tabular-nums ${k.tone === "signal" && k.value > 0 ? "text-signal" : "text-ink"}`}>
                    {k.value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Search bar ───────────────────────────────────────────────── */}
          <div className="relative max-w-md">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
              placeholder="Search by slug or name…"
              className="pl-8"
              aria-label="Search tenants"
            />
          </div>

          {error && (
            <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger" role="alert">
              {error}
            </div>
          )}

          {/* ── Table card ────────────────────────────────────────────── */}
          <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead className="bg-paper">
                <tr>
                  {["Slug", "Name", "Tier", "Status", "Region", "Updated", "Version", ""].map((h) => (
                    <th key={h} className="border-b border-line px-3 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-3">
                      <LoadingState rows={3} ariaLabel="Loading tenants" />
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-4">
                      <EmptyState
                        code="◇ no tenants"
                        title="No tenants match your search."
                        description="Create a new tenant to get started — slug, display name, tier."
                        action={<Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={13} className="mr-1" />New Tenant</Button>}
                      />
                    </td>
                  </tr>
                ) : items.map((t) => (
                  <tr key={t.id} className="border-b border-line/60 transition-colors hover:bg-paper">
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
            {/* Pagination footer */}
            <div className="flex items-center justify-between border-t border-line bg-paper px-3 py-2 text-[12px] text-ink-3">
              <span className="font-mono tabular-nums">
                {total} tenants · page {page + 1} of {Math.max(1, Math.ceil(total / pageSize))}
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
          </div>
        </div>
      </div>

      <CreateDialog open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); refresh(); }} />
      <EditDialog tenant={editTarget} onClose={() => setEditTarget(null)} onSaved={() => { setEditTarget(null); refresh(); }} />
      <DeleteDialog tenant={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); refresh(); }} />
    </div>
  );
}

// Create dialog
function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tenant["tier"]>("shared");
  const [region, setRegion] = useState<string>(REGIONS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const slugInvalid = slug.length > 0 && !isSlug(slug);
  const canSubmit = !slugInvalid && slug.length > 0 && name.length > 0 && !busy;

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
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
    <Dialog
      open={open}
      onClose={onClose}
      title="Create tenant"
      description="A new tenant gets its own RLS partition + audit timeline."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>Create</Button>
        </>
      }
    >
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
            <SelectNative ariaLabel="Tier" value={tier} onChange={(v) => setTier(v as Tenant["tier"])} options={TIERS} />
          </Field>
          <Field label="Region">
            <SelectNative ariaLabel="Region" value={region} onChange={setRegion} options={REGIONS} />
          </Field>
        </div>
        {err && (
          <div role="alert" className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>
        )}
      </form>
    </Dialog>
  );
}

// Edit dialog
function EditDialog({ tenant, onClose, onSaved }: { tenant: Tenant | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(tenant?.name ?? "");
  const [tier, setTier] = useState<Tenant["tier"]>(tenant?.tier ?? "shared");
  const [status, setStatus] = useState<Tenant["status"]>(tenant?.status ?? "active");
  const [region, setRegion] = useState(tenant?.region ?? REGIONS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Sync state when target changes
  useEffect(() => {
    if (tenant) {
      setName(tenant.name);
      setTier(tenant.tier);
      setStatus(tenant.status);
      setRegion(tenant.region);
      setErr(null);
    }
  }, [tenant]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!tenant) return;
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
    <Dialog
      open={!!tenant}
      onClose={onClose}
      title={tenant ? `Edit ${tenant.slug}` : "Edit tenant"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>Save</Button>
        </>
      }
    >
      {tenant && (
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
              <SelectNative ariaLabel="Tier" value={tier} onChange={(v) => setTier(v as Tenant["tier"])} options={TIERS} />
            </Field>
            <Field label="Status">
              <SelectNative ariaLabel="Status" value={status} onChange={(v) => setStatus(v as Tenant["status"])} options={STATUSES} />
            </Field>
          </div>
          <Field label="Region">
            <SelectNative ariaLabel="Region" value={region} onChange={setRegion} options={REGIONS} />
          </Field>
          {err && (
            <div role="alert" className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>
          )}
        </form>
      )}
    </Dialog>
  );
}

// Delete confirmation
function DeleteDialog({ tenant, onClose, onDeleted }: { tenant: Tenant | null; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (tenant) { setConfirm(""); setErr(null); }
  }, [tenant]);

  async function submit() {
    if (!tenant) return;
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
    <Dialog
      open={!!tenant}
      onClose={onClose}
      title="Delete tenant"
      description="Soft-delete · 30-day retention before purge"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            disabled={!tenant || confirm !== tenant.slug}
            loading={busy}
            onClick={submit}
          >
            Delete tenant
          </Button>
        </>
      }
    >
      {tenant && (
        <div className="space-y-4">
          <p className="text-sm text-ink-2">
            This soft-deletes <span className="font-mono text-ink">{tenant.slug}</span>. Data is retained 30 days then purged.
          </p>
          <Field label={`Type ${tenant.slug} to confirm`}>
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="font-mono" />
          </Field>
          {err && (
            <div role="alert" className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</div>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ── Reusable atoms ─────────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-3">
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
  ariaLabel,
}: {
  value: string;
  onChange: (v: T) => void;
  options: readonly T[];
  ariaLabel: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      aria-label={ariaLabel}
      className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
    >
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
