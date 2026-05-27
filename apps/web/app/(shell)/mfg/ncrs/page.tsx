"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  listNCRs, createNCR, getNCR, updateNCR, getCAPA, attachCAPA, updateCAPA,
  type NCR, type NcrStatus, type CAPA,
} from "@/lib/api/quality";
import { listItems, listLotsForItem, type Item, type Lot } from "@/lib/api/mfg";

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "investigating", label: "Investigating" },
  { value: "corrected", label: "Corrected" },
  { value: "closed", label: "Closed" },
];

function statusTone(s: NcrStatus): "danger" | "warning" | "info" | "success" {
  if (s === "open") return "danger";
  if (s === "investigating") return "warning";
  if (s === "corrected") return "info";
  return "success";
}

function severityTone(sev: number): "neutral" | "warning" | "danger" {
  if (sev <= 2) return "neutral";
  if (sev <= 3) return "warning";
  return "danger";
}

function NewNcrDialog({ items, onClose, onCreated }: {
  items: Item[];
  onClose: () => void;
  onCreated: (n: NCR) => void;
}) {
  const [form, setForm] = useState({ item_id: "", lot_id: "", qty: "1", severity: "3", description: "" });
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchItem(q: string) {
    if (!q.trim()) { setItemResults([]); return; }
    try { const r = await listItems({ q, limit: 10 }); setItemResults(r.items); } catch { /* noop */ }
  }

  async function selectItem(it: Item) {
    setForm(f => ({ ...f, item_id: it.id, lot_id: "" }));
    setItemQuery(`${it.code} — ${it.name}`);
    setItemResults([]);
    try { setLots(await listLotsForItem(it.id)); } catch { setLots([]); }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.item_id || !form.description) { setError("Item and Description are required"); return; }
    setLoading(true); setError(null);
    try {
      const n = await createNCR({
        item_id: form.item_id,
        qty: Number(form.qty),
        severity: Number(form.severity),
        description: form.description,
        lot_id: form.lot_id || undefined,
      });
      onCreated(n);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create NCR");
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-md border border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">New NCR</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-4">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Item *</label>
            <div className="relative">
              <Input value={itemQuery} onChange={e => { setItemQuery(e.target.value); void searchItem(e.target.value); }} placeholder="Search item code…" />
              {itemResults.length > 0 && (
                <ul className="absolute left-0 top-full z-30 mt-1 w-full rounded-sm border border-line bg-surface shadow-pop">
                  {itemResults.map(it => (
                    <li key={it.id} className="cursor-pointer px-3 py-1.5 text-xs hover:bg-surface-2" onClick={() => void selectItem(it)}>
                      <span className="font-mono">{it.code}</span> — {it.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {lots.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Lot (optional)</label>
              <select title="Lot" value={form.lot_id} onChange={e => setForm(f => ({ ...f, lot_id: e.target.value }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                <option value="">— none —</option>
                {lots.map(l => <option key={l.id} value={l.id}>{l.lotNo} ({l.status})</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Qty *</label>
              <Input type="number" min="1" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Severity (1-5) *</label>
              <select title="Severity" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} — {["Negligible", "Minor", "Moderate", "Major", "Critical"][n - 1]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Description *</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} required
              className="h-20 w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none resize-none"
              placeholder="Describe the nonconformance…" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>Create NCR</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NcrDetailPane({ ncr, itemMap, onClose, onUpdated }: {
  ncr: NCR;
  itemMap: Map<string, Item>;
  onClose: () => void;
  onUpdated: (n: NCR) => void;
}) {
  const [form, setForm] = useState({ status: ncr.status, severity: ncr.severity, description: ncr.description, qty: ncr.qty });
  const [capa, setCapa] = useState<CAPA | null>(null);
  const [capaLoading, setCapaLoading] = useState(true);
  const [capaForm, setCapaForm] = useState({ root_cause: "", action: "", owner_id: "", target_date: "" });
  const [showCapaForm, setShowCapaForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = itemMap.get(ncr.itemId);

  useEffect(() => {
    getCAPA(ncr.id).then(c => { setCapa(c); setCapaLoading(false); }).catch(() => setCapaLoading(false));
  }, [ncr.id]);

  async function save() {
    setSaving(true); setError(null);
    try {
      const updated = await updateNCR(ncr.id, {
        status: form.status as NcrStatus, severity: form.severity,
        description: form.description, qty: form.qty, version: ncr.version,
      });
      onUpdated(updated);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function submitCapa(e: React.FormEvent) {
    e.preventDefault();
    if (!capaForm.root_cause || !capaForm.action) { setError("Root cause and action are required"); return; }
    setSaving(true); setError(null);
    try {
      const c = await attachCAPA(ncr.id, {
        root_cause: capaForm.root_cause,
        action: capaForm.action,
        owner_id: capaForm.owner_id || undefined,
        target_date: capaForm.target_date || undefined,
      });
      setCapa(c);
      setShowCapaForm(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to attach CAPA"); }
    finally { setSaving(false); }
  }

  async function saveCapaEdit() {
    if (!capa) return;
    setSaving(true); setError(null);
    try {
      const updated = await updateCAPA(capa.id, {
        root_cause: capa.rootCause, action: capa.action,
        status: capa.status, target_date: capa.targetDate,
        evidence: capa.evidence, owner_id: capa.ownerId,
      });
      setCapa(updated);
    } catch (e) { setError(e instanceof Error ? e.message : "CAPA save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-ink-3">NCR</span>
            <span className="font-mono text-sm font-semibold text-ink">{ncr.id.slice(0, 8)}</span>
            <Tag tone={statusTone(ncr.status)} dot>{ncr.status}</Tag>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="primary" loading={saving} onClick={save}>Save</Button>
            <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          {item && <div className="text-xs text-ink-2"><span className="font-mono font-medium text-ink">{item.code}</span> — {item.name}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Status</label>
              <select title="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as NcrStatus }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="corrected">Corrected</option>
                <option value="closed">Closed</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Severity</label>
              <select title="Severity" value={form.severity} onChange={e => setForm(f => ({ ...f, severity: Number(e.target.value) }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Qty</label>
            <Input type="number" min="1" value={form.qty} onChange={e => setForm(f => ({ ...f, qty: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Description</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="h-24 w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none resize-none" />
          </div>

          {/* CAPA section */}
          <div className="border-t border-line pt-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-3">CAPA</h3>
            {capaLoading ? (
              <p className="text-xs text-ink-3">Loading…</p>
            ) : capa ? (
              <div className="space-y-3 rounded-sm border border-line bg-surface p-3">
                <div className="flex items-center justify-between">
                  <Tag tone={capa.status === "closed" ? "success" : capa.status === "open" ? "danger" : "info"}>{capa.status}</Tag>
                  <Button type="button" size="sm" variant="ghost" loading={saving} onClick={saveCapaEdit}>Save CAPA</Button>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-ink-3">Root Cause</label>
                  <textarea value={capa.rootCause} onChange={e => setCapa(c => c ? { ...c, rootCause: e.target.value } : c)}
                    className="h-16 w-full rounded-xs border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none resize-none" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-ink-3">Corrective Action</label>
                  <textarea value={capa.action} onChange={e => setCapa(c => c ? { ...c, action: e.target.value } : c)}
                    className="h-16 w-full rounded-xs border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-ink-3">Status</label>
                    <select title="CAPA Status" value={capa.status} onChange={e => setCapa(c => c ? { ...c, status: e.target.value } : c)}
                      className="h-8 w-full rounded-xs border border-line bg-surface-2 px-2 text-xs focus:border-accent focus:outline-none">
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="verified">Verified</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-ink-3">Target Date</label>
                    <Input type="date" value={capa.targetDate?.split("T")[0] ?? ""} onChange={e => setCapa(c => c ? { ...c, targetDate: e.target.value || null } : c)} className="h-8 text-xs" />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-ink-3">Evidence</label>
                  <Input value={capa.evidence} onChange={e => setCapa(c => c ? { ...c, evidence: e.target.value } : c)} placeholder="Link or reference…" className="h-8 text-xs" />
                </div>
              </div>
            ) : showCapaForm ? (
              <form onSubmit={submitCapa} className="space-y-3 rounded-sm border border-line bg-surface p-3">
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-ink-3">Root Cause *</label>
                  <textarea value={capaForm.root_cause} onChange={e => setCapaForm(f => ({ ...f, root_cause: e.target.value }))} required
                    className="h-16 w-full rounded-xs border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none resize-none" placeholder="What caused this nonconformance?" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-ink-3">Corrective Action *</label>
                  <textarea value={capaForm.action} onChange={e => setCapaForm(f => ({ ...f, action: e.target.value }))} required
                    className="h-16 w-full rounded-xs border border-line bg-surface-2 px-2 py-1.5 text-xs text-ink focus:border-accent focus:outline-none resize-none" placeholder="What will be done to fix it?" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-ink-3">Owner</label>
                    <Input value={capaForm.owner_id} onChange={e => setCapaForm(f => ({ ...f, owner_id: e.target.value }))} placeholder="User ID" className="h-8 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-ink-3">Target Date</label>
                    <Input type="date" value={capaForm.target_date} onChange={e => setCapaForm(f => ({ ...f, target_date: e.target.value }))} className="h-8 text-xs" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button type="submit" size="sm" variant="primary" loading={saving}>Attach CAPA</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setShowCapaForm(false)}>Cancel</Button>
                </div>
              </form>
            ) : (
              <div className="rounded-sm border border-dashed border-line bg-surface p-4 text-center">
                <p className="mb-2 text-xs text-ink-3">No CAPA attached to this NCR.</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowCapaForm(true)}>Attach CAPA</Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NcrsPage() {
  const router = useRouter();
  const [ncrs, setNcrs] = useState<NCR[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<NCR | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setNcrs(await listNCRs({ status: statusFilter || undefined })); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to load NCRs"); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void listItems({ limit: 500 }).then(r => {
      setItems(r.items);
      setItemMap(new Map(r.items.map(i => [i.id, i])));
    }).catch(() => {});
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "NCR / CAPA" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New NCR", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {STATUS_TABS.map(t => (
            <button key={t.value} type="button" onClick={() => setStatusFilter(t.value)}
              className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-ink-3">{ncrs.length} NCRs</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading && !ncrs.length ? (
          <div className="space-y-px">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">ID</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {ncrs.map(n => {
                const item = itemMap.get(n.itemId);
                return (
                  <tr key={n.id} onClick={() => router.push('/quality/ncrs/' + n.id)}
                    className="cursor-pointer border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-mono text-xs text-ink-3">{n.id.slice(0, 8)}</td>
                    <td className="px-4 py-2">
                      {item ? <span className="font-mono text-xs">{item.code}</span> : <span className="font-mono text-xs text-ink-3">{n.itemId.slice(0, 8)}</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{n.qty}</td>
                    <td className="px-4 py-2"><Tag tone={severityTone(n.severity)}>{n.severity}</Tag></td>
                    <td className="px-4 py-2 text-xs text-ink-2 max-w-xs truncate">{n.description}</td>
                    <td className="px-4 py-2"><Tag tone={statusTone(n.status)} dot>{n.status}</Tag></td>
                    <td className="px-4 py-2 text-xs text-ink-3">
                      {n.createdAt ? new Date(n.createdAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                );
              })}
              {!loading && ncrs.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="flex flex-col items-center gap-2 py-16 text-fgMuted">
                      <p className="text-sm text-ink-3">No NCRs found.</p>
                      <Button size="sm" variant="ghost" onClick={() => setShowNew(true)}>+ New NCR</Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewNcrDialog items={items} onClose={() => setShowNew(false)} onCreated={n => {
          setNcrs(prev => [n, ...prev]);
          setShowNew(false);
          setSelected(n);
        }} />
      )}

      {selected && (
        <NcrDetailPane ncr={selected} itemMap={itemMap} onClose={() => setSelected(null)} onUpdated={updated => {
          setNcrs(prev => prev.map(n => n.id === updated.id ? updated : n));
          setSelected(updated);
        }} />
      )}
    </div>
  );
}
