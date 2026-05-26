"use client";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  getFmea, updateFmea, listFmeaModes, addFmeaMode, updateFmeaMode, deleteFmeaMode,
  type Fmea, type FmeaMode,
} from "@/lib/api/quality";
import { listItems, type Item } from "@/lib/api/mfg";

function rpnTone(rpn: number): "success" | "warning" | "danger" | "neutral" {
  if (rpn === 0) return "neutral";
  if (rpn < 40) return "success";
  if (rpn <= 100) return "warning";
  return "danger";
}

const EMPTY_MODE = {
  function: "", failure_mode: "", effect: "", severity: 5, cause: "",
  occurrence: 5, detection: 5, actions: "", target_date: "", sort_order: 0,
};

type DraftMode = typeof EMPTY_MODE;

function ModeRow({ mode, onDelete, onUpdate }: {
  mode: FmeaMode;
  onDelete: (id: string) => void;
  onUpdate: (updated: FmeaMode) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    function: mode.function,
    failure_mode: mode.failureMode,
    effect: mode.effect,
    severity: mode.severity,
    cause: mode.cause,
    occurrence: mode.occurrence,
    detection: mode.detection,
    actions: mode.actions,
    target_date: mode.targetDate?.split("T")[0] ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true); setErr(null);
    try {
      const updated = await updateFmeaMode(mode.id, {
        function: form.function, failure_mode: form.failure_mode, effect: form.effect,
        severity: form.severity, cause: form.cause, occurrence: form.occurrence,
        detection: form.detection, actions: form.actions,
        target_date: form.target_date || null,
      });
      onUpdate(updated);
      setEditing(false);
    } catch (e) { setErr(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function del() {
    if (saving) return;
    setSaving(true);
    try { await deleteFmeaMode(mode.id); onDelete(mode.id); }
    catch (e) { setErr(e instanceof Error ? e.message : "Delete failed"); setSaving(false); }
  }

  if (!editing) {
    return (
      <tr className="border-b border-line hover:bg-surface-2 cursor-pointer" onClick={() => setEditing(true)}>
        <td className="px-3 py-2 font-mono text-xs text-ink-3">{mode.sortOrder}</td>
        <td className="px-3 py-2 text-xs text-ink">{mode.function || "—"}</td>
        <td className="px-3 py-2 text-xs text-ink">{mode.failureMode || "—"}</td>
        <td className="px-3 py-2 text-xs text-ink-2 max-w-32 truncate">{mode.effect || "—"}</td>
        <td className="px-3 py-2 font-mono text-xs text-center">{mode.severity}</td>
        <td className="px-3 py-2 text-xs text-ink-2 max-w-32 truncate">{mode.cause || "—"}</td>
        <td className="px-3 py-2 font-mono text-xs text-center">{mode.occurrence}</td>
        <td className="px-3 py-2 font-mono text-xs text-center">{mode.detection}</td>
        <td className="px-3 py-2 text-center">
          <Tag tone={rpnTone(mode.rpn)}>{mode.rpn}</Tag>
        </td>
        <td className="px-3 py-2 text-xs text-ink-2 max-w-40 truncate">{mode.actions || "—"}</td>
        <td className="px-3 py-2 text-xs text-ink-3">{mode.targetDate ? new Date(mode.targetDate).toLocaleDateString() : "—"}</td>
        <td className="px-3 py-2">
          <button type="button" onClick={e => { e.stopPropagation(); void del(); }}
            className="text-xs text-ink-3 hover:text-danger">✕</button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-accent/30 bg-accent-soft/10">
      <td colSpan={12} className="px-3 py-3">
        {err && <p className="mb-2 text-xs text-danger">{err}</p>}
        <div className="grid grid-cols-4 gap-2 mb-2">
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Function</label>
            <Input value={form.function} onChange={e => setForm(f => ({ ...f, function: e.target.value }))} className="h-7 text-xs" />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Failure Mode</label>
            <Input value={form.failure_mode} onChange={e => setForm(f => ({ ...f, failure_mode: e.target.value }))} className="h-7 text-xs" />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Effect</label>
            <Input value={form.effect} onChange={e => setForm(f => ({ ...f, effect: e.target.value }))} className="h-7 text-xs" />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Cause</label>
            <Input value={form.cause} onChange={e => setForm(f => ({ ...f, cause: e.target.value }))} className="h-7 text-xs" />
          </div>
        </div>
        <div className="grid grid-cols-6 gap-2 mb-2">
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Severity (1-10)</label>
            <Input type="number" min={1} max={10} value={form.severity} onChange={e => setForm(f => ({ ...f, severity: Number(e.target.value) }))} className="h-7 text-xs" />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Occurrence (1-10)</label>
            <Input type="number" min={1} max={10} value={form.occurrence} onChange={e => setForm(f => ({ ...f, occurrence: Number(e.target.value) }))} className="h-7 text-xs" />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Detection (1-10)</label>
            <Input type="number" min={1} max={10} value={form.detection} onChange={e => setForm(f => ({ ...f, detection: Number(e.target.value) }))} className="h-7 text-xs" />
          </div>
          <div className="col-span-2">
            <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Actions</label>
            <Input value={form.actions} onChange={e => setForm(f => ({ ...f, actions: e.target.value }))} className="h-7 text-xs" />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Target Date</label>
            <Input type="date" value={form.target_date} onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))} className="h-7 text-xs" />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="primary" loading={saving} onClick={save}>Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </td>
    </tr>
  );
}

export default function FmeaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [fmea, setFmea] = useState<Fmea | null>(null);
  const [modes, setModes] = useState<FmeaMode[]>([]);
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nameEdit, setNameEdit] = useState("");
  const [addingMode, setAddingMode] = useState(false);
  const [draft, setDraft] = useState<DraftMode>({ ...EMPTY_MODE });
  const [draftErr, setDraftErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [f, ms] = await Promise.all([getFmea(id), listFmeaModes(id)]);
      setFmea(f);
      setNameEdit(f.name);
      setModes(ms.sort((a, b) => b.rpn - a.rpn));
      const itemsRes = await listItems({ limit: 500 });
      setItem(itemsRes.items.find(i => i.id === f.itemId) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load FMEA");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function saveName() {
    if (!fmea) return;
    setSaving(true);
    try {
      const updated = await updateFmea(id, { name: nameEdit, version: fmea.version });
      setFmea(updated);
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setSaving(false); }
  }

  async function addMode() {
    if (!draft.function || !draft.failure_mode) { setDraftErr("Function and Failure Mode are required"); return; }
    setDraftErr(null); setSaving(true);
    try {
      const m = await addFmeaMode(id, {
        function: draft.function, failure_mode: draft.failure_mode, effect: draft.effect,
        severity: draft.severity, cause: draft.cause, occurrence: draft.occurrence,
        detection: draft.detection, actions: draft.actions,
        target_date: draft.target_date || undefined,
        sort_order: draft.sort_order,
      });
      setModes(prev => [m, ...prev].sort((a, b) => b.rpn - a.rpn));
      setDraft({ ...EMPTY_MODE });
      setAddingMode(false);
    } catch (e) { setDraftErr(e instanceof Error ? e.message : "Failed to add mode"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-ink-3">Loading…</div>;
  if (error) return <div className="m-6 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>;
  if (!fmea) return <div className="m-6 text-sm text-ink-3">Not found.</div>;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[
        { label: "Home", href: "/quality/home" },
        { label: "FMEA", href: "/quality/fmea" },
        { label: fmea.name },
      ]} />
      <CommandBar actions={[
        { id: "back", label: "← Back", variant: "ghost", onClick: () => router.push("/quality/fmea") },
        { id: "save", label: "Save Name", variant: "primary", onClick: saveName, disabled: saving || nameEdit === fmea.name },
        { id: "add", label: "+ Add Mode", variant: "ghost", onClick: () => setAddingMode(!addingMode) },
      ]} />

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-3">
        <Input value={nameEdit} onChange={e => setNameEdit(e.target.value)} className="max-w-72 font-semibold" />
        <Tag tone={fmea.type === "pfmea" ? "accent" : "info"}>{fmea.type.toUpperCase()}</Tag>
        <Tag tone={fmea.status === "active" ? "success" : "neutral"}>{fmea.status}</Tag>
        {item && <span className="font-mono text-xs text-ink-2">{item.code} — {item.name}</span>}
        {fmea.team.length > 0 && (
          <span className="text-xs text-ink-3">Team: {fmea.team.join(", ")}</span>
        )}
        <span className="ml-auto text-xs text-ink-3">v{fmea.version}</span>
      </div>

      {/* Add mode form */}
      {addingMode && (
        <div className="border-b border-line bg-surface p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-3">Add Failure Mode</h3>
          {draftErr && <p className="mb-2 text-xs text-danger">{draftErr}</p>}
          <div className="grid grid-cols-4 gap-2 mb-2">
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Function *</label>
              <Input value={draft.function} onChange={e => setDraft(d => ({ ...d, function: e.target.value }))} className="h-7 text-xs" placeholder="Process step" />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Failure Mode *</label>
              <Input value={draft.failure_mode} onChange={e => setDraft(d => ({ ...d, failure_mode: e.target.value }))} className="h-7 text-xs" placeholder="What fails?" />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Effect</label>
              <Input value={draft.effect} onChange={e => setDraft(d => ({ ...d, effect: e.target.value }))} className="h-7 text-xs" placeholder="Impact" />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Cause</label>
              <Input value={draft.cause} onChange={e => setDraft(d => ({ ...d, cause: e.target.value }))} className="h-7 text-xs" placeholder="Root cause" />
            </div>
          </div>
          <div className="grid grid-cols-6 gap-2 mb-3">
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Severity</label>
              <Input type="number" min={1} max={10} value={draft.severity} onChange={e => setDraft(d => ({ ...d, severity: Number(e.target.value) }))} className="h-7 text-xs" />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Occurrence</label>
              <Input type="number" min={1} max={10} value={draft.occurrence} onChange={e => setDraft(d => ({ ...d, occurrence: Number(e.target.value) }))} className="h-7 text-xs" />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Detection</label>
              <Input type="number" min={1} max={10} value={draft.detection} onChange={e => setDraft(d => ({ ...d, detection: Number(e.target.value) }))} className="h-7 text-xs" />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Preview RPN</label>
              <div className="flex h-7 items-center">
                <Tag tone={rpnTone(draft.severity * draft.occurrence * draft.detection)}>
                  {draft.severity * draft.occurrence * draft.detection}
                </Tag>
              </div>
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Actions</label>
              <Input value={draft.actions} onChange={e => setDraft(d => ({ ...d, actions: e.target.value }))} className="h-7 text-xs" />
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] font-medium text-ink-3">Target Date</label>
              <Input type="date" value={draft.target_date} onChange={e => setDraft(d => ({ ...d, target_date: e.target.value }))} className="h-7 text-xs" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="primary" loading={saving} onClick={addMode}>Add Mode</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setAddingMode(false); setDraftErr(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Function</th>
              <th className="px-3 py-2">Failure Mode</th>
              <th className="px-3 py-2">Effect</th>
              <th className="px-3 py-2 text-center">S</th>
              <th className="px-3 py-2">Cause</th>
              <th className="px-3 py-2 text-center">O</th>
              <th className="px-3 py-2 text-center">D</th>
              <th className="px-3 py-2 text-center">RPN</th>
              <th className="px-3 py-2">Actions</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {modes.map(m => (
              <ModeRow key={m.id} mode={m}
                onDelete={delId => setModes(prev => prev.filter(x => x.id !== delId))}
                onUpdate={updated => setModes(prev => prev.map(x => x.id === updated.id ? updated : x).sort((a, b) => b.rpn - a.rpn))}
              />
            ))}
            {modes.length === 0 && (
              <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-ink-3">No failure modes yet. Click "+ Add Mode" to create one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
