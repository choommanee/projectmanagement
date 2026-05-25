"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import { listUoms, createUom, type UOM } from "@/lib/api/mfg";

function NewUOMDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ code: "", name: "", ratio_to_base: "1" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code || !form.name) { setError("Code and Name are required"); return; }
    setLoading(true);
    setError(null);
    try {
      await createUom({ code: form.code, name: form.name, ratio_to_base: Number(form.ratio_to_base) });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create UOM");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-sm rounded-md border border-line bg-paper p-4 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-ink">New Unit of Measure</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Code * (e.g. EA, KG, M)</label>
            <Input value={form.code} onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="EA" required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Each" required />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Ratio to Base</label>
            <Input type="number" min="0.000001" step="any" value={form.ratio_to_base} onChange={(e) => setForm(f => ({ ...f, ratio_to_base: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>Create UOM</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function UOMsPage() {
  const [uoms, setUoms] = useState<UOM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listUoms();
      setUoms(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load UOMs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Units of Measure" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New UOM", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="flex items-center border-b border-line bg-paper px-4 py-2">
        <span className="text-xs text-ink-3">{uoms.length} units of measure</span>
        <p className="ml-4 text-xs text-ink-3">UoMs are immutable once created.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading ? (
          <div className="space-y-px">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-border bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Ratio to Base</th>
              </tr>
            </thead>
            <tbody>
              {uoms.map((uom) => (
                <tr key={uom.id} className="border-b border-line hover:bg-surface-2">
                  <td className="px-4 py-2 font-mono text-sm font-semibold text-ink">{uom.code}</td>
                  <td className="px-4 py-2 text-ink">{uom.name}</td>
                  <td className="px-4 py-2 font-mono text-sm text-ink-2">{uom.ratioToBase}</td>
                </tr>
              ))}
              {!loading && uoms.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    <div className="flex flex-col items-center gap-2 py-16 text-fgMuted">
                      <p className="text-sm text-ink-3">No units of measure yet.</p>
                      <Button size="sm" variant="ghost" onClick={() => setShowNew(true)}>+ New UOM</Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && <NewUOMDialog onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); void load(); }} />}
    </div>
  );
}
