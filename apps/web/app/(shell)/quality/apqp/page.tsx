"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  listApqp, createApqp, updateApqp, deleteApqp,
  type ApqpProject, type ApqpPhase, type ApqpStatus, type Milestone,
} from "@/lib/api/quality";
import { listItems, type Item } from "@/lib/api/mfg";
import { UserPicker } from "@/components/UserPicker";

const PHASES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "concept", label: "Concept" },
  { value: "design", label: "Design" },
  { value: "process", label: "Process" },
  { value: "validation", label: "Validation" },
  { value: "production", label: "Production" },
  { value: "feedback", label: "Feedback" },
];

function phaseTone(p: ApqpPhase): "neutral" | "info" | "accent" | "success" | "warning" | "danger" | "signal" {
  if (p === "concept") return "neutral";
  if (p === "design") return "info";
  if (p === "process") return "accent";
  if (p === "validation") return "warning";
  if (p === "production") return "success";
  if (p === "feedback") return "signal";
  return "neutral";
}

function statusTone(s: ApqpStatus): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "not_started") return "neutral";
  if (s === "in_progress") return "info";
  if (s === "complete") return "success";
  if (s === "blocked") return "danger";
  return "neutral";
}

function NewApqpDialog({ items, onClose, onCreated }: {
  items: Item[];
  onClose: () => void;
  onCreated: (p: ApqpProject) => void;
}) {
  const [form, setForm] = useState({ name: "", item_id: "", phase: "concept" as ApqpPhase, target_date: "", owner_id: "" });
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
    if (!form.name || !form.item_id) { setError("Name and Item are required"); return; }
    setLoading(true); setError(null);
    try {
      const p = await createApqp({
        item_id: form.item_id,
        name: form.name,
        phase: form.phase,
        target_date: form.target_date || undefined,
        owner_id: form.owner_id || undefined,
      });
      onCreated(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-md border border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">New APQP Project</h2>
          <button onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
        </div>
        <form onSubmit={submit} className="space-y-4 p-4">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name *</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Brake Pad APQP 2026" required />
          </div>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Phase</label>
              <select title="Phase" value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value as ApqpPhase }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                {PHASES.filter(p => p.value).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Target Date</label>
              <Input type="date" value={form.target_date} onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Owner (optional)</label>
            <UserPicker
              value={form.owner_id}
              onChange={id => setForm(f => ({ ...f, owner_id: id }))}
              placeholder="Owner (search by name)"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>Create APQP</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ApqpDetailPane({ project, itemMap, onClose, onUpdated, onDeleted }: {
  project: ApqpProject;
  itemMap: Map<string, Item>;
  onClose: () => void;
  onUpdated: (p: ApqpProject) => void;
  onDeleted: (id: string) => void;
}) {
  const [form, setForm] = useState({
    name: project.name,
    phase: project.phase,
    status: project.status,
    owner_id: project.ownerId,
    target_date: project.targetDate?.split("T")[0] ?? "",
  });
  const [milestones, setMilestones] = useState<Milestone[]>(project.milestones ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  const item = itemMap.get(project.itemId);

  async function save() {
    setSaving(true); setError(null);
    try {
      const updated = await updateApqp(project.id, {
        name: form.name,
        phase: form.phase as ApqpPhase,
        status: form.status as ApqpStatus,
        owner_id: form.owner_id || undefined,
        target_date: form.target_date || null,
        milestones,
        version: project.version,
      });
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally { setSaving(false); }
  }

  async function doDelete() {
    if (deleteConfirm !== project.name) { setError("Name does not match"); return; }
    setDeleting(true);
    try {
      await deleteApqp(project.id, project.version);
      onClose();
      onDeleted(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally { setDeleting(false); }
  }

  function addMilestone() {
    setMilestones(ms => [...ms, { name: "", due: "", done: false }]);
  }

  function removeMilestone(i: number) {
    setMilestones(ms => ms.filter((_, idx) => idx !== i));
  }

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">{project.name}</h2>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="primary" loading={saving} onClick={save}>Save</Button>
            <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          {item && (
            <div className="rounded-xs bg-surface px-3 py-2 text-xs text-ink-2">
              <span className="font-mono font-medium text-ink">{item.code}</span> — {item.name}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Name</label>
            <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Phase</label>
              <select title="Phase" value={form.phase} onChange={e => setForm(f => ({ ...f, phase: e.target.value as ApqpPhase }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                {PHASES.filter(p => p.value).map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Status</label>
              <select title="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as ApqpStatus }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                <option value="not_started">Not Started</option>
                <option value="in_progress">In Progress</option>
                <option value="complete">Complete</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Target Date</label>
              <Input type="date" value={form.target_date} onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Owner</label>
              <UserPicker
                value={form.owner_id}
                onChange={id => setForm(f => ({ ...f, owner_id: id }))}
                placeholder="Owner (search by name)"
              />
            </div>
          </div>

          {/* Milestones */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">Milestones</span>
              <Button type="button" size="sm" variant="ghost" onClick={addMilestone}>+ Add</Button>
            </div>
            {milestones.length === 0 && (
              <p className="text-xs text-ink-3">No milestones yet. Click + Add to create one.</p>
            )}
            <div className="space-y-2">
              {milestones.map((ms, i) => (
                <div key={i} className="flex items-center gap-2 rounded-xs border border-line bg-surface px-2 py-1.5">
                  <input type="checkbox" title="Done" checked={ms.done} onChange={e => setMilestones(list => list.map((m, idx) => idx === i ? { ...m, done: e.target.checked } : m))}
                    className="h-3.5 w-3.5 accent-accent" />
                  <input title="Milestone name" className="flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-3" placeholder="Milestone name"
                    value={ms.name} onChange={e => setMilestones(list => list.map((m, idx) => idx === i ? { ...m, name: e.target.value } : m))} />
                  <input type="date" title="Due date" className="bg-transparent text-xs text-ink-2 outline-none"
                    value={ms.due} onChange={e => setMilestones(list => list.map((m, idx) => idx === i ? { ...m, due: e.target.value } : m))} />
                  <button type="button" onClick={() => removeMilestone(i)} className="text-ink-3 hover:text-danger">✕</button>
                </div>
              ))}
            </div>
          </div>

          {/* Danger zone */}
          <div className="rounded-sm border border-danger/30 bg-danger/5 p-3">
            <p className="mb-2 text-xs font-medium text-danger">Delete APQP Project</p>
            <p className="mb-2 text-xs text-ink-3">Type <span className="font-mono font-medium">{project.name}</span> to confirm.</p>
            <div className="flex gap-2">
              <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder={project.name} className="flex-1 text-xs" />
              <Button size="sm" variant="danger" loading={deleting} disabled={deleteConfirm !== project.name} onClick={doDelete}>Delete</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ApqpPage() {
  const [projects, setProjects] = useState<ApqpProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [phaseFilter, setPhaseFilter] = useState("");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [selected, setSelected] = useState<ApqpProject | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const list = await listApqp();
      setProjects(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load APQP projects");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void load();
    void listItems({ limit: 500 }).then(r => {
      setItems(r.items);
      setItemMap(new Map(r.items.map(i => [i.id, i])));
    }).catch(() => {});
  }, [load]);

  const filtered = projects.filter(p => {
    if (phaseFilter && p.phase !== phaseFilter) return false;
    if (q && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  function handleUpdated(p: ApqpProject) {
    setProjects(prev => prev.map(x => x.id === p.id ? p : x));
    setSelected(p);
  }

  function handleDeleted(id: string) {
    setProjects(prev => prev.filter(x => x.id !== id));
    setSelected(null);
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/quality/home" }, { label: "APQP" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New APQP", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {PHASES.map(t => (
            <button key={t.value} onClick={() => setPhaseFilter(t.value)}
              className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${phaseFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search APQP…" className="max-w-48 h-8 text-xs" />
        <span className="ml-auto text-xs text-ink-3">{filtered.length} projects</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading && !projects.length ? (
          <div className="space-y-px">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-border bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Phase</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Target Date</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">v</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const item = itemMap.get(p.itemId);
                return (
                  <tr key={p.id} onClick={() => setSelected(p)}
                    className="cursor-pointer border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-medium text-ink">{p.name}</td>
                    <td className="px-4 py-2">
                      {item ? (
                        <span className="font-mono text-xs text-ink">{item.code}</span>
                      ) : (
                        <span className="font-mono text-xs text-ink-3">{p.itemId.slice(0, 8)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2"><Tag tone={phaseTone(p.phase)}>{p.phase}</Tag></td>
                    <td className="px-4 py-2"><Tag tone={statusTone(p.status)} dot>{p.status.replace("_", " ")}</Tag></td>
                    <td className="px-4 py-2 text-xs text-ink-3">
                      {p.targetDate ? new Date(p.targetDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">{p.ownerId || "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink-3">{p.version}</td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="flex flex-col items-center gap-2 py-16 text-fgMuted">
                      <p className="text-sm text-ink-3">No APQP projects found.</p>
                      <Button size="sm" variant="ghost" onClick={() => setShowNew(true)}>+ New APQP</Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewApqpDialog items={items} onClose={() => setShowNew(false)} onCreated={p => {
          setProjects(prev => [p, ...prev]);
          setShowNew(false);
          setSelected(p);
        }} />
      )}

      {selected && (
        <ApqpDetailPane project={selected} itemMap={itemMap} onClose={() => setSelected(null)} onUpdated={handleUpdated} onDeleted={handleDeleted} />
      )}
    </div>
  );
}
