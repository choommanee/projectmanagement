"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  listControlPlans, createControlPlan, getControlPlan, updateControlPlan,
  listControlPlanChars, addControlPlanChar, updateControlPlanChar, deleteControlPlanChar,
  type ControlPlan, type ControlPlanChar,
} from "@/lib/api/quality";
import { listItems, type Item } from "@/lib/api/mfg";

function NewCpDialog({ items, onClose, onCreated }: {
  items: Item[];
  onClose: () => void;
  onCreated: (cp: ControlPlan) => void;
}) {
  const [form, setForm] = useState({ item_id: "", name: "" });
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchItem(q: string) {
    if (!q.trim()) { setItemResults([]); return; }
    try { const r = await listItems({ q, limit: 10 }); setItemResults(r.items); } catch { /* noop */ }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.item_id || !form.name) { setError("Item and Name are required"); return; }
    setLoading(true); setError(null);
    try { onCreated(await createControlPlan({ item_id: form.item_id, name: form.name })); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to create"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-md border border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">New Control Plan</h2>
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
                    <li key={it.id} className="cursor-pointer px-3 py-1.5 text-xs hover:bg-surface-2"
                      onClick={() => { setForm(f => ({ ...f, item_id: it.id })); setItemQuery(`${it.code} — ${it.name}`); setItemResults([]); }}>
                      <span className="font-mono">{it.code}</span> — {it.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Assembly Control Plan v1" required />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>Create</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

type CharDraft = {
  no: string; characteristic: string; spec: string; sample_size: string;
  sample_freq: string; measurement_method: string; reaction_plan: string;
};

function CpDetailPane({ cp, itemMap, onClose, onUpdated }: {
  cp: ControlPlan;
  itemMap: Map<string, Item>;
  onClose: () => void;
  onUpdated: (cp: ControlPlan) => void;
}) {
  const [chars, setChars] = useState<ControlPlanChar[]>([]);
  const [charsLoading, setCharsLoading] = useState(true);
  const [addingChar, setAddingChar] = useState(false);
  const [draft, setDraft] = useState<CharDraft>({ no: "", characteristic: "", spec: "", sample_size: "1", sample_freq: "", measurement_method: "", reaction_plan: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingCharId, setEditingCharId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CharDraft>({ no: "", characteristic: "", spec: "", sample_size: "1", sample_freq: "", measurement_method: "", reaction_plan: "" });

  const item = itemMap.get(cp.itemId);

  useEffect(() => {
    setCharsLoading(true);
    listControlPlanChars(cp.id).then(list => {
      setChars(list.sort((a, b) => a.sortOrder - b.sortOrder));
      setCharsLoading(false);
    }).catch(() => setCharsLoading(false));
  }, [cp.id]);

  async function addChar() {
    if (!draft.characteristic) { setError("Characteristic is required"); return; }
    setSaving(true); setError(null);
    try {
      const c = await addControlPlanChar(cp.id, {
        no: Number(draft.no) || chars.length + 1,
        characteristic: draft.characteristic,
        spec: draft.spec,
        sample_size: Number(draft.sample_size) || 1,
        sample_freq: draft.sample_freq,
        measurement_method: draft.measurement_method,
        reaction_plan: draft.reaction_plan,
        sort_order: chars.length,
      });
      setChars(prev => [...prev, c]);
      setDraft({ no: "", characteristic: "", spec: "", sample_size: "1", sample_freq: "", measurement_method: "", reaction_plan: "" });
      setAddingChar(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to add"); }
    finally { setSaving(false); }
  }

  async function saveCharEdit(id: string) {
    setSaving(true); setError(null);
    try {
      const updated = await updateControlPlanChar(id, {
        characteristic: editForm.characteristic, spec: editForm.spec,
        sample_size: Number(editForm.sample_size) || 1, sample_freq: editForm.sample_freq,
        measurement_method: editForm.measurement_method, reaction_plan: editForm.reaction_plan,
      });
      setChars(prev => prev.map(c => c.id === id ? updated : c));
      setEditingCharId(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function deleteChar(id: string) {
    try {
      await deleteControlPlanChar(id);
      setChars(prev => prev.filter(c => c.id !== id));
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
  }

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="ml-auto flex h-full w-full max-w-4xl flex-col border-l border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-ink">{cp.name}</h2>
            <Tag tone={cp.status === "active" ? "success" : "neutral"}>{cp.status}</Tag>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setAddingChar(!addingChar)}>+ Add Char</Button>
            <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
          </div>
        </div>
        {item && (
          <div className="border-b border-line bg-surface px-4 py-2 text-xs text-ink-2">
            <span className="font-mono font-medium text-ink">{item.code}</span> — {item.name}
          </div>
        )}
        {error && <p className="border-b border-line bg-danger/5 px-4 py-2 text-xs text-danger">{error}</p>}

        {/* Add char inline */}
        {addingChar && (
          <div className="border-b border-line bg-surface p-3">
            <div className="grid grid-cols-7 gap-2 mb-2">
              <div><label className="mb-0.5 block text-[10px] font-medium text-ink-3">#</label><Input value={draft.no} onChange={e => setDraft(d => ({ ...d, no: e.target.value }))} className="h-7 text-xs" placeholder="Auto" /></div>
              <div className="col-span-2"><label className="mb-0.5 block text-[10px] font-medium text-ink-3">Characteristic *</label><Input value={draft.characteristic} onChange={e => setDraft(d => ({ ...d, characteristic: e.target.value }))} className="h-7 text-xs" /></div>
              <div><label className="mb-0.5 block text-[10px] font-medium text-ink-3">Spec</label><Input value={draft.spec} onChange={e => setDraft(d => ({ ...d, spec: e.target.value }))} className="h-7 text-xs" /></div>
              <div><label className="mb-0.5 block text-[10px] font-medium text-ink-3">Sample Size</label><Input type="number" value={draft.sample_size} onChange={e => setDraft(d => ({ ...d, sample_size: e.target.value }))} className="h-7 text-xs" /></div>
              <div><label className="mb-0.5 block text-[10px] font-medium text-ink-3">Frequency</label><Input value={draft.sample_freq} onChange={e => setDraft(d => ({ ...d, sample_freq: e.target.value }))} className="h-7 text-xs" placeholder="e.g. per shift" /></div>
              <div><label className="mb-0.5 block text-[10px] font-medium text-ink-3">Method</label><Input value={draft.measurement_method} onChange={e => setDraft(d => ({ ...d, measurement_method: e.target.value }))} className="h-7 text-xs" /></div>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="primary" loading={saving} onClick={addChar}>Add</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setAddingChar(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {charsLoading ? (
            <div className="flex h-20 items-center justify-center text-sm text-ink-3">Loading…</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left font-medium text-ink-3">
                  <th className="px-3 py-2 w-10">#</th>
                  <th className="px-3 py-2">Characteristic</th>
                  <th className="px-3 py-2">Spec</th>
                  <th className="px-3 py-2">Sample Size</th>
                  <th className="px-3 py-2">Frequency</th>
                  <th className="px-3 py-2">Method</th>
                  <th className="px-3 py-2">Reaction Plan</th>
                  <th className="px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {chars.map(c => editingCharId === c.id ? (
                  <tr key={c.id} className="border-b border-accent/30 bg-accent-soft/10">
                    <td className="px-3 py-2 font-mono text-ink-3">{c.no}</td>
                    <td className="px-3 py-2"><Input value={editForm.characteristic} onChange={e => setEditForm(f => ({ ...f, characteristic: e.target.value }))} className="h-7 text-xs" /></td>
                    <td className="px-3 py-2"><Input value={editForm.spec} onChange={e => setEditForm(f => ({ ...f, spec: e.target.value }))} className="h-7 text-xs" /></td>
                    <td className="px-3 py-2"><Input type="number" value={editForm.sample_size} onChange={e => setEditForm(f => ({ ...f, sample_size: e.target.value }))} className="h-7 text-xs w-16" /></td>
                    <td className="px-3 py-2"><Input value={editForm.sample_freq} onChange={e => setEditForm(f => ({ ...f, sample_freq: e.target.value }))} className="h-7 text-xs" /></td>
                    <td className="px-3 py-2"><Input value={editForm.measurement_method} onChange={e => setEditForm(f => ({ ...f, measurement_method: e.target.value }))} className="h-7 text-xs" /></td>
                    <td className="px-3 py-2"><Input value={editForm.reaction_plan} onChange={e => setEditForm(f => ({ ...f, reaction_plan: e.target.value }))} className="h-7 text-xs" /></td>
                    <td className="px-3 py-2 flex gap-1">
                      <Button type="button" size="sm" variant="primary" loading={saving} onClick={() => saveCharEdit(c.id)}>✓</Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditingCharId(null)}>✕</Button>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id} className="border-b border-line hover:bg-surface-2 cursor-pointer"
                    onClick={() => { setEditingCharId(c.id); setEditForm({ no: String(c.no), characteristic: c.characteristic, spec: c.spec, sample_size: String(c.sampleSize), sample_freq: c.sampleFreq, measurement_method: c.measurementMethod, reaction_plan: c.reactionPlan }); }}>
                    <td className="px-3 py-2 font-mono text-ink-3">{c.no}</td>
                    <td className="px-3 py-2 text-ink font-medium">{c.characteristic}</td>
                    <td className="px-3 py-2 text-ink-2">{c.spec || "—"}</td>
                    <td className="px-3 py-2 font-mono">{c.sampleSize}</td>
                    <td className="px-3 py-2 text-ink-2">{c.sampleFreq || "—"}</td>
                    <td className="px-3 py-2 text-ink-2">{c.measurementMethod || "—"}</td>
                    <td className="px-3 py-2 text-ink-2">{c.reactionPlan || "—"}</td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={e => { e.stopPropagation(); void deleteChar(c.id); }}
                        className="text-ink-3 hover:text-danger">✕</button>
                    </td>
                  </tr>
                ))}
                {chars.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-ink-3">No characteristics. Click "+ Add Char" to create one.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ControlPlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<ControlPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [showNew, setShowNew] = useState(false);
  const [selected, setSelected] = useState<ControlPlan | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setPlans(await listControlPlans()); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    void listItems({ limit: 500 }).then(r => {
      setItems(r.items);
      setItemMap(new Map(r.items.map(i => [i.id, i])));
    }).catch(() => {});
  }, [load]);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/quality/home" }, { label: "Control Plans" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Control Plan", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading && !plans.length ? (
          <div className="space-y-px">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">v</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(cp => {
                const item = itemMap.get(cp.itemId);
                return (
                  <tr key={cp.id} onClick={() => router.push('/quality/control-plans/' + cp.id)}
                    className="cursor-pointer border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-medium text-ink">{cp.name}</td>
                    <td className="px-4 py-2">
                      {item ? <span className="font-mono text-xs">{item.code}</span> : <span className="font-mono text-xs text-ink-3">{cp.itemId.slice(0, 8)}</span>}
                    </td>
                    <td className="px-4 py-2"><Tag tone={cp.status === "active" ? "success" : "neutral"}>{cp.status}</Tag></td>
                    <td className="px-4 py-2 text-xs text-ink-3">{cp.version}</td>
                  </tr>
                );
              })}
              {!loading && plans.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="flex flex-col items-center gap-2 py-16 text-fgMuted">
                      <p className="text-sm text-ink-3">No control plans found.</p>
                      <Button size="sm" variant="ghost" onClick={() => setShowNew(true)}>+ New Control Plan</Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewCpDialog items={items} onClose={() => setShowNew(false)} onCreated={cp => {
          setPlans(prev => [cp, ...prev]);
          setShowNew(false);
          setSelected(cp);
        }} />
      )}

      {selected && (
        <CpDetailPane cp={selected} itemMap={itemMap} onClose={() => setSelected(null)} onUpdated={updated => {
          setPlans(prev => prev.map(p => p.id === updated.id ? updated : p));
          setSelected(updated);
        }} />
      )}
    </div>
  );
}
