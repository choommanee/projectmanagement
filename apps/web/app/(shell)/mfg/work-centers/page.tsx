"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog, EmptyState, LoadingState } from "@pmplatform/ui-kit";
import {
  listWorkCenters, createWorkCenter, updateWorkCenter, deleteWorkCenter,
  type WorkCenter, type WCType, type ItemStatus,
} from "@/lib/api/mfg";

const WC_TYPE_OPTIONS: WCType[] = ["machine", "labor", "cell"];
const TYPE_TONES: Record<WCType, "accent" | "info" | "neutral"> = {
  machine: "accent", labor: "info", cell: "neutral",
};

function WCDialog({
  wc, onClose, onSaved,
}: { wc?: WorkCenter | null; onClose: () => void; onSaved: () => void }) {
  const editing = Boolean(wc);
  const [form, setForm] = useState({
    code: wc?.code ?? "",
    name: wc?.name ?? "",
    type: (wc?.type ?? "machine") as WCType,
    capacity_per_day_hrs: String(wc?.capacityPerDayHrs ?? 8),
    machine_count: String(wc?.machineCount ?? 1),
    status: (wc?.status ?? "active") as ItemStatus,
    version: wc?.version ?? 1,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code || !form.name) { setError("Code and Name are required"); return; }
    setLoading(true);
    setError(null);
    try {
      if (editing && wc) {
        await updateWorkCenter(wc.id, {
          name: form.name,
          type: form.type,
          capacity_per_day_hrs: Number(form.capacity_per_day_hrs),
          machine_count: Number(form.machine_count),
          status: form.status,
          version: form.version,
        });
      } else {
        await createWorkCenter({
          code: form.code,
          name: form.name,
          type: form.type,
          capacity_per_day_hrs: Number(form.capacity_per_day_hrs),
          machine_count: Number(form.machine_count),
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={true}
      onClose={onClose}
      title={editing ? "Edit Work Center" : "New Work Center"}
      description={editing ? "Update work center configuration." : "Add a new work center to the shop floor."}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={loading} onClick={() => { const f = document.getElementById("wc-form") as HTMLFormElement | null; f?.requestSubmit(); }}>
            {editing ? "Save" : "Create"}
          </Button>
        </>
      }
    >
      <form id="wc-form" onSubmit={submit} className="space-y-3">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Code *</label>
            <Input value={form.code} onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))} disabled={editing} placeholder="WC-001" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Lathe Station 1" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Type</label>
            <select
              aria-label="Work center type"
              value={form.type}
              onChange={(e) => setForm(f => ({ ...f, type: e.target.value as WCType }))}
              className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {WC_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Capacity (hrs/day)</label>
            <Input
              type="number" min="0" step="0.5"
              value={form.capacity_per_day_hrs}
              onChange={(e) => setForm(f => ({ ...f, capacity_per_day_hrs: e.target.value }))}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Machine Count</label>
            <Input
              type="number" min="1" step="1"
              value={form.machine_count}
              onChange={(e) => setForm(f => ({ ...f, machine_count: e.target.value }))}
            />
          </div>
          {editing && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Status</label>
              <select
                aria-label="Status"
                value={form.status}
                onChange={(e) => setForm(f => ({ ...f, status: e.target.value as ItemStatus }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}
        </div>
      </form>
    </Dialog>
  );
}

function DeleteConfirmDialog({ wc, onClose, onDeleted }: { wc: WorkCenter; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      await deleteWorkCenter(wc.id, wc.version);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={true}
      onClose={onClose}
      title="Delete work center"
      description={`Remove "${wc.code} — ${wc.name}" permanently? This cannot be undone.`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={loading} onClick={() => void confirm()}>Delete</Button>
        </>
      }
    >
      {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
    </Dialog>
  );
}

export default function WorkCentersPage() {
  const router = useRouter();
  const [wcs, setWcs] = useState<WorkCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // undefined = closed, null = new WC dialog, WorkCenter object = edit
  const [dialogWC, setDialogWC] = useState<WorkCenter | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<WorkCenter | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listWorkCenters();
      setWcs(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load work centers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => wcs.filter(w =>
      !q ||
      w.code.toLowerCase().includes(q.toLowerCase()) ||
      w.name.toLowerCase().includes(q.toLowerCase())
    ),
    [wcs, q]
  );

  const kpis = useMemo(() => {
    const total = wcs.length;
    const active = wcs.filter(w => w.status === "active").length;
    const machines = wcs.filter(w => w.type === "machine").length;
    const labor = wcs.filter(w => w.type === "labor").length;
    const cells = wcs.filter(w => w.type === "cell").length;
    const totalMachines = wcs.reduce((s, w) => s + (w.machineCount ?? 0), 0);
    return { total, active, machines, labor, cells, totalMachines };
  }, [wcs]);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Work Centers" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Work Center", variant: "primary", onClick: () => setDialogWC(null) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">

          {/* Editorial header */}
          <header className="reveal-up flex items-end justify-between gap-6 border-b border-line pb-5">
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
                ◢ shop floor · capacity
              </div>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
                Work Centers
              </h1>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">total</div>
              <div className="font-mono text-[11px] tabular-nums text-ink-2">{wcs.length} work centers</div>
            </div>
          </header>

          {/* KPI strip */}
          <section className="reveal-up relative overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs" aria-label="Work center KPIs">
            <div aria-hidden className="pointer-events-none absolute inset-0 blueprint-grid" />
            <div className="relative grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-y divide-line lg:divide-y-0 lg:divide-x">
              {[
                { label: "total",    value: kpis.total,        tone: "accent" as const },
                { label: "active",   value: kpis.active,       tone: "accent" as const },
                { label: "machine",  value: kpis.machines,     tone: "accent" as const },
                { label: "labor",    value: kpis.labor,        tone: "accent" as const },
                { label: "cell",     value: kpis.cells,        tone: "accent" as const },
                { label: "machines", value: kpis.totalMachines, tone: "signal" as const },
              ].map((k) => (
                <div key={k.label} className="flex flex-col gap-1 px-4 py-4">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${k.tone === "signal" ? "bg-signal" : "bg-accent"}`} />
                    {k.label}
                  </div>
                  <div className="font-mono text-[22px] font-semibold leading-none tabular-nums text-ink">
                    {k.value}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Filter row */}
          <div className="flex items-center gap-3">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search code or name…"
              className="max-w-64 h-8 text-xs"
              aria-label="Search work centers"
            />
            <span className="ml-auto font-mono text-xs text-ink-3">{filtered.length} results</span>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          {loading && !wcs.length ? (
            <LoadingState rows={5} ariaLabel="Loading work centers" />
          ) : filtered.length === 0 ? (
            <EmptyState
              code="◇ no work centers"
              title="No work centers found."
              description="Add a work center to start scheduling operations."
              action={<Button variant="primary" onClick={() => setDialogWC(null)}>+ New Work Center</Button>}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <th className="px-4 py-2.5">Code</th>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Capacity (hrs/day)</th>
                    <th className="px-4 py-2.5">Machines</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Created</th>
                    <th className="px-4 py-2.5 sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((wc) => (
                    <tr key={wc.id} onClick={() => router.push('/mfg/work-centers/' + wc.id)} className="border-b border-line/60 last:border-0 hover:bg-paper cursor-pointer">
                      <td className="px-4 py-2 font-mono text-xs font-semibold uppercase text-ink">{wc.code}</td>
                      <td className="px-4 py-2 font-medium text-ink">{wc.name}</td>
                      <td className="px-4 py-2">
                        <Tag tone={TYPE_TONES[wc.type]}>{wc.type}</Tag>
                      </td>
                      <td className="px-4 py-2 font-mono text-sm tabular-nums text-ink-2">{wc.capacityPerDayHrs}</td>
                      <td className="px-4 py-2 font-mono text-sm tabular-nums text-ink-2">{wc.machineCount}</td>
                      <td className="px-4 py-2">
                        <Tag tone={wc.status === "active" ? "success" : "neutral"} dot>{wc.status}</Tag>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs tabular-nums text-ink-3">
                        {wc.createdAt ? new Date(wc.createdAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setDialogWC(wc)}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(wc)}>Delete</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {dialogWC !== undefined && (
        <WCDialog
          wc={dialogWC}
          onClose={() => setDialogWC(undefined)}
          onSaved={() => { setDialogWC(undefined); void load(); }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          wc={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); void load(); }}
        />
      )}
    </div>
  );
}
