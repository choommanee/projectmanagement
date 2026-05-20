"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import { listWorkCenters, createWorkCenter, updateWorkCenter, type WorkCenter, type WCType, type ItemStatus } from "@/lib/api/mfg";

const WC_TYPE_OPTIONS: WCType[] = ["machine", "labor", "cell"];
const TYPE_TONES: Record<WCType, "accent" | "info" | "neutral"> = { machine: "accent", labor: "info", cell: "neutral" };

function WCDialog({ wc, onClose, onSaved }: { wc?: WorkCenter | null; onClose: () => void; onSaved: () => void }) {
  const editing = Boolean(wc);
  const [form, setForm] = useState({
    code: wc?.code ?? "",
    name: wc?.name ?? "",
    type: (wc?.type ?? "machine") as WCType,
    capacity_per_day_hrs: String(wc?.capacityPerDayHrs ?? 8),
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
          name: form.name, type: form.type,
          capacity_per_day_hrs: Number(form.capacity_per_day_hrs),
          status: form.status, version: form.version,
        });
      } else {
        await createWorkCenter({ code: form.code, name: form.name, type: form.type, capacity_per_day_hrs: Number(form.capacity_per_day_hrs) });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-full max-w-md rounded-md border border-line bg-paper p-4 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-ink">{editing ? "Edit Work Center" : "New Work Center"}</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Code *</label>
              <Input value={form.code} onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))} disabled={editing} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Type</label>
              <select value={form.type} onChange={(e) => setForm(f => ({ ...f, type: e.target.value as WCType }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none">
                {WC_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Capacity (hrs/day)</label>
              <Input type="number" min="0" step="0.5" value={form.capacity_per_day_hrs} onChange={(e) => setForm(f => ({ ...f, capacity_per_day_hrs: e.target.value }))} />
            </div>
          </div>
          {editing && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Status</label>
              <select value={form.status} onChange={(e) => setForm(f => ({ ...f, status: e.target.value as ItemStatus }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>{editing ? "Save" : "Create"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function WorkCentersPage() {
  const [wcs, setWcs] = useState<WorkCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogWC, setDialogWC] = useState<WorkCenter | null | undefined>(undefined); // undefined = closed, null = new
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

  const filtered = wcs.filter(w => !q || w.code.toLowerCase().includes(q.toLowerCase()) || w.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Work Centers" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Work Center", variant: "primary", onClick: () => setDialogWC(null) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search work centers…" className="max-w-64 h-8 text-xs" />
        <span className="ml-auto text-xs text-ink-3">{filtered.length} work centers</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-ink-3">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Capacity (hrs/day)</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((wc) => (
                <tr key={wc.id} className="border-b border-line hover:bg-surface-2">
                  <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{wc.code}</td>
                  <td className="px-4 py-2 font-medium text-ink">{wc.name}</td>
                  <td className="px-4 py-2"><Tag tone={TYPE_TONES[wc.type]}>{wc.type}</Tag></td>
                  <td className="px-4 py-2 font-mono text-sm">{wc.capacityPerDayHrs}</td>
                  <td className="px-4 py-2"><Tag tone={wc.status === "active" ? "success" : "neutral"} dot>{wc.status}</Tag></td>
                  <td className="px-4 py-2">
                    <Button size="sm" variant="ghost" onClick={() => setDialogWC(wc)}>Edit</Button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-3">No work centers found.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {dialogWC !== undefined && (
        <WCDialog wc={dialogWC} onClose={() => setDialogWC(undefined)} onSaved={() => { setDialogWC(undefined); void load(); }} />
      )}
    </div>
  );
}
