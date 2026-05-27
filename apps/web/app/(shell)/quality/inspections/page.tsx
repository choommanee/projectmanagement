"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  listInspections, createInspection, getInspection,
  type Inspection, type InspectionResult,
} from "@/lib/api/quality";
import { listItems, listLotsForItem, type Item, type Lot } from "@/lib/api/mfg";

const RESULT_TABS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "hold", label: "Hold" },
];

function resultTone(r: InspectionResult): "success" | "danger" | "warning" {
  if (r === "pass") return "success";
  if (r === "fail") return "danger";
  return "warning";
}

type KvRow = { key: string; value: string };

function NewInspectionDialog({ items, onClose, onCreated }: {
  items: Item[];
  onClose: () => void;
  onCreated: (i: Inspection) => void;
}) {
  const [form, setForm] = useState({
    item_id: "", lot_id: "", work_order_id: "", inspector: "",
    result: "pass" as InspectionResult, notes: "",
  });
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [lots, setLots] = useState<Lot[]>([]);
  const [measurements, setMeasurements] = useState<KvRow[]>([]);
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
    if (!form.item_id || !form.inspector) { setError("Item and Inspector are required"); return; }
    setLoading(true); setError(null);
    const meas = measurements.filter(m => m.key.trim()).map(m => ({ key: m.key, value: m.value }));
    try {
      const i = await createInspection({
        item_id: form.item_id,
        inspector: form.inspector,
        result: form.result,
        work_order_id: form.work_order_id || undefined,
        lot_id: form.lot_id || undefined,
        measurements: meas,
        notes: form.notes || undefined,
      });
      onCreated(i);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create inspection");
    } finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-md border border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">New Inspection</h2>
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
                {lots.map(l => <option key={l.id} value={l.id}>{l.lotNo}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Inspector *</label>
              <Input value={form.inspector} onChange={e => setForm(f => ({ ...f, inspector: e.target.value }))} placeholder="Name or ID" required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Result *</label>
              <select title="Result" value={form.result} onChange={e => setForm(f => ({ ...f, result: e.target.value as InspectionResult }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                <option value="pass">Pass</option>
                <option value="fail">Fail</option>
                <option value="hold">Hold</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Work Order ID (optional)</label>
            <Input value={form.work_order_id} onChange={e => setForm(f => ({ ...f, work_order_id: e.target.value }))} placeholder="WO UUID" />
          </div>

          {/* Measurements key/value */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-ink-2">Measurements</label>
              <Button type="button" size="sm" variant="ghost" onClick={() => setMeasurements(m => [...m, { key: "", value: "" }])}>+ Add</Button>
            </div>
            {measurements.map((m, i) => (
              <div key={i} className="mb-1 flex gap-2">
                <Input value={m.key} onChange={e => setMeasurements(ms => ms.map((x, j) => j === i ? { ...x, key: e.target.value } : x))} placeholder="e.g. diameter_mm" className="h-8 text-xs flex-1" />
                <Input value={m.value} onChange={e => setMeasurements(ms => ms.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="e.g. 12.05" className="h-8 text-xs flex-1" />
                <button type="button" onClick={() => setMeasurements(ms => ms.filter((_, j) => j !== i))} className="text-ink-3 hover:text-danger text-xs">✕</button>
              </div>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="h-16 w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none resize-none" placeholder="Optional notes…" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" loading={loading}>Create Inspection</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InspectionModal({ id, itemMap, onClose }: { id: string; itemMap: Map<string, Item>; onClose: () => void }) {
  const [insp, setInsp] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getInspection(id).then(i => { setInsp(i); setLoading(false); }).catch(() => setLoading(false));
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-md border border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Inspection Detail</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
        </div>
        <div className="p-4">
          {loading && <div className="text-sm text-ink-3">Loading…</div>}
          {insp && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Tag tone={resultTone(insp.result)} dot>{insp.result}</Tag>
                <span className="text-xs text-ink-3">{new Date(insp.inspectedAt).toLocaleString()}</span>
                <span className="text-xs text-ink-2">by {insp.inspector}</span>
              </div>
              {itemMap.get(insp.itemId) && (
                <div className="text-xs text-ink-2">
                  Item: <span className="font-mono font-medium text-ink">{itemMap.get(insp.itemId)!.code}</span> — {itemMap.get(insp.itemId)!.name}
                </div>
              )}
              {insp.lotId && <div className="text-xs text-ink-2">Lot: <span className="font-mono">{insp.lotId.slice(0, 8)}</span></div>}
              {insp.workOrderId && <div className="text-xs text-ink-2">WO: <span className="font-mono">{insp.workOrderId.slice(0, 8)}</span></div>}
              {insp.measurements.length > 0 && (
                <div>
                  <p className="mb-1 text-[10px] font-medium text-ink-3">Measurements</p>
                  <div className="rounded-xs border border-line bg-surface divide-y divide-line">
                    {insp.measurements.map((m, i) => (
                      <div key={i} className="flex justify-between px-3 py-1.5 text-xs">
                        <span className="font-mono text-ink-2">{String((m as Record<string, unknown>).key ?? "")}</span>
                        <span className="font-mono text-ink">{String((m as Record<string, unknown>).value ?? "")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {insp.notes && <div className="text-xs text-ink-2">{insp.notes}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function InspectionsPage() {
  const router = useRouter();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resultFilter, setResultFilter] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [showNew, setShowNew] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setInspections(await listInspections({ result: resultFilter || undefined })); }
    catch (err) { setError(err instanceof Error ? err.message : "Failed to load inspections"); }
    finally { setLoading(false); }
  }, [resultFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void listItems({ limit: 500 }).then(r => {
      setItems(r.items);
      setItemMap(new Map(r.items.map(i => [i.id, i])));
    }).catch(() => {});
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/quality/home" }, { label: "Inspections" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New Inspection", variant: "primary", onClick: () => setShowNew(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-2">
        <div className="flex flex-wrap gap-1">
          {RESULT_TABS.map(t => (
            <button key={t.value} type="button" onClick={() => setResultFilter(t.value)}
              className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${resultFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-ink-3">{inspections.length} inspections</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}
        {loading && !inspections.length ? (
          <div className="space-y-px">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Inspected At</th>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Lot</th>
                <th className="px-4 py-2">Inspector</th>
                <th className="px-4 py-2">Result</th>
                <th className="px-4 py-2">Work Order</th>
              </tr>
            </thead>
            <tbody>
              {inspections.map(insp => {
                const item = itemMap.get(insp.itemId);
                return (
                  <tr key={insp.id} onClick={() => router.push('/quality/inspections/' + insp.id)}
                    className="cursor-pointer border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 text-xs text-ink-2">
                      {insp.inspectedAt ? new Date(insp.inspectedAt).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {item ? (
                        <div>
                          <div className="font-mono text-xs text-ink">{item.code}</div>
                          <div className="text-xs text-ink-3">{item.name}</div>
                        </div>
                      ) : <span className="font-mono text-xs text-ink-3">{insp.itemId.slice(0, 8)}</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-2">{insp.lotId ? insp.lotId.slice(0, 8) : "—"}</td>
                    <td className="px-4 py-2 text-xs text-ink-2">{insp.inspector}</td>
                    <td className="px-4 py-2"><Tag tone={resultTone(insp.result)} dot>{insp.result}</Tag></td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-3">{insp.workOrderId ? insp.workOrderId.slice(0, 8) : "—"}</td>
                  </tr>
                );
              })}
              {!loading && inspections.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="flex flex-col items-center gap-2 py-16 text-fgMuted">
                      <p className="text-sm text-ink-3">No inspections found.</p>
                      <Button size="sm" variant="ghost" onClick={() => setShowNew(true)}>+ New Inspection</Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {showNew && (
        <NewInspectionDialog items={items} onClose={() => setShowNew(false)} onCreated={i => {
          setInspections(prev => [i, ...prev]);
          setShowNew(false);
        }} />
      )}

      {detailId && (
        <InspectionModal id={detailId} itemMap={itemMap} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}
