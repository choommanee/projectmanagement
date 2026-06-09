"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Dialog, EmptyState, LoadingState } from "@pmplatform/ui-kit";
import { listUoms, createUom, deleteUom, type UOM } from "@/lib/api/mfg";

function NewUOMDialog({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    code: "",
    name: "",
    ratio_to_base: "1",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code || !form.name) { setError("Code and Name are required"); return; }
    setLoading(true);
    setError(null);
    try {
      await createUom({
        code: form.code,
        name: form.name,
        ratio_to_base: Number(form.ratio_to_base),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create UOM");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={true}
      onClose={onClose}
      title="New Unit of Measure"
      description="UoMs are immutable once created — choose codes carefully."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => { const f = document.getElementById("uom-form") as HTMLFormElement | null; f?.requestSubmit(); }}>
            Create UoM
          </Button>
        </>
      }
    >
      <form id="uom-form" onSubmit={submit} className="space-y-3">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Code * (e.g. EA, KG)</label>
            <Input
              value={form.code}
              onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="EA"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Each"
              required
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Conversion Factor (ratio to base)</label>
          <Input
            type="number"
            min="0.000001"
            step="any"
            value={form.ratio_to_base}
            onChange={(e) => setForm(f => ({ ...f, ratio_to_base: e.target.value }))}
            placeholder="1"
          />
          <p className="mt-1 text-[11px] text-ink-3">1 = a base unit; e.g. 1000 if this unit equals 1000 base units.</p>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteUOMDialog({ uom, onClose, onDeleted }: { uom: UOM; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setLoading(true);
    setError(null);
    try {
      await deleteUom(uom.id);
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
      title="Delete unit of measure"
      description={`Remove "${uom.code} — ${uom.name}" permanently? Items referencing this UoM will be affected.`}
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

export default function UOMsPage() {
  const [uoms, setUoms] = useState<UOM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UOM | null>(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listUoms();
      setUoms(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load UoMs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(
    () => uoms.filter(u =>
      !q ||
      u.code.toLowerCase().includes(q.toLowerCase()) ||
      u.name.toLowerCase().includes(q.toLowerCase())
    ),
    [uoms, q]
  );

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Units of Measure" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New UoM", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">

          {/* Editorial header */}
          <header className="reveal-up flex items-end justify-between gap-6 border-b border-line pb-5">
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
                ◢ master data · uom
              </div>
              <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
                Units of Measure
              </h1>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">total</div>
              <div className="font-mono text-[11px] tabular-nums text-ink-2">{uoms.length} units</div>
            </div>
          </header>

          {/* KPI strip */}
          <section className="reveal-up relative overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs" aria-label="UoM KPIs">
            <div aria-hidden className="pointer-events-none absolute inset-0 blueprint-grid" />
            <div className="relative grid grid-cols-2 sm:grid-cols-3 divide-y divide-line sm:divide-y-0 sm:divide-x">
              {[
                { label: "total UoMs",  value: uoms.length },
                { label: "base units",  value: uoms.filter(u => u.ratioToBase === 1).length },
                { label: "derived",     value: uoms.filter(u => u.ratioToBase !== 1).length },
              ].map((k) => (
                <div key={k.label} className="flex flex-col gap-1 px-4 py-4">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
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
              aria-label="Search UoMs"
            />
            <span className="ml-auto font-mono text-xs text-ink-3">{filtered.length} results</span>
          </div>

          {error && (
            <div role="alert" className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</div>
          )}

          {loading && !uoms.length ? (
            <LoadingState rows={5} ariaLabel="Loading units of measure" />
          ) : filtered.length === 0 ? (
            <EmptyState
              code="◇ no uoms"
              title="No units of measure defined."
              description="Create base units first (EA, KG, M), then derived units with a conversion factor."
              action={<Button variant="primary" onClick={() => setShowNew(true)}>+ New UoM</Button>}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-paper text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                    <th className="px-4 py-2.5">Code</th>
                    <th className="px-4 py-2.5">Name</th>
                    <th className="px-4 py-2.5">Base UoM</th>
                    <th className="px-4 py-2.5">Conversion Factor</th>
                    <th className="px-4 py-2.5 sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((uom) => {
                    // ratioToBase === 1 → this is a base unit; otherwise display ratio
                    const isBase = uom.ratioToBase === 1;
                    return (
                      <tr key={uom.id} className="border-b border-line/60 last:border-0 hover:bg-paper">
                        <td className="px-4 py-2 font-mono text-xs font-semibold uppercase text-ink">{uom.code}</td>
                        <td className="px-4 py-2 text-ink">{uom.name}</td>
                        <td className="px-4 py-2 font-mono text-xs text-ink-3">
                          {isBase ? <span className="text-accent">BASE</span> : "—"}
                        </td>
                        <td className="px-4 py-2 font-mono text-sm tabular-nums text-ink-2">{uom.ratioToBase}</td>
                        <td className="px-4 py-2">
                          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(uom)}>Delete</Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showNew && (
        <NewUOMDialog
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); void load(); }}
        />
      )}

      {deleteTarget && (
        <DeleteUOMDialog
          uom={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => { setDeleteTarget(null); void load(); }}
        />
      )}
    </div>
  );
}
