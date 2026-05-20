"use client";
import { useCallback, useEffect, useState } from "react";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  type BOMHeader, type BOMLine, type BomExplodeRow, type Item, type UOM,
  activateBom, addBomLine, updateBomLine, deleteBomLine, explodeBom, listItems, getBom,
} from "@/lib/api/mfg";

function BomStatusTag({ status }: { status: string }) {
  const tone = status === "active" ? "success" : status === "draft" ? "neutral" : "warning";
  return <Tag tone={tone} dot>{status}</Tag>;
}

function AddLineRow({ uoms, onAdd }: { uoms: UOM[]; onAdd: (line: { child_item_id: string; qty: number; uom_id: string; scrap_pct?: number; is_phantom?: boolean }) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [qty, setQty] = useState("1");
  const [uomId, setUomId] = useState(uoms[0]?.id ?? "");
  const [scrap, setScrap] = useState("0");
  const [phantom, setPhantom] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(q: string) {
    if (!q.trim()) { setResults([]); return; }
    try {
      const r = await listItems({ q, limit: 10 });
      setResults(r.items);
    } catch {
      setResults([]);
    }
  }

  async function handleAdd() {
    if (!selected) { setError("Select a child item"); return; }
    if (Number(qty) <= 0) { setError("Qty must be > 0"); return; }
    setAdding(true);
    setError(null);
    try {
      await onAdd({ child_item_id: selected.id, qty: Number(qty), uom_id: uomId, scrap_pct: Number(scrap), is_phantom: phantom });
      setQuery("");
      setSelected(null);
      setQty("1");
      setScrap("0");
      setPhantom(false);
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add line");
    } finally {
      setAdding(false);
    }
  }

  return (
    <tr className="border-b border-line bg-accent-soft/10">
      <td className="px-3 py-2" colSpan={2}>
        <div className="relative">
          <Input value={query} onChange={(e) => { setQuery(e.target.value); void search(e.target.value); }} placeholder="Search child item…" className="h-8 text-xs" />
          {results.length > 0 && (
            <ul className="absolute left-0 top-full z-30 mt-1 w-full rounded-sm border border-line bg-surface shadow-pop">
              {results.map(r => (
                <li key={r.id} className="cursor-pointer px-3 py-1.5 text-xs hover:bg-surface-2" onClick={() => { setSelected(r); setQuery(r.code + " — " + r.name); setUomId(r.uomId); setResults([]); }}>
                  <span className="font-mono">{r.code}</span> — {r.name}
                </li>
              ))}
            </ul>
          )}
        </div>
        {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
      </td>
      <td className="px-3 py-2">
        <Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="0.001" step="any" className="h-8 w-20 text-xs font-mono" />
      </td>
      <td className="px-3 py-2">
        <select value={uomId} onChange={(e) => setUomId(e.target.value)}
          className="h-8 w-20 rounded-sm border border-line bg-surface px-2 text-xs focus:border-accent focus:outline-none">
          {uoms.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        <Input value={scrap} onChange={(e) => setScrap(e.target.value)} type="number" min="0" step="any" className="h-8 w-16 text-xs font-mono" />
      </td>
      <td className="px-3 py-2 text-center">
        <input type="checkbox" checked={phantom} onChange={(e) => setPhantom(e.target.checked)} className="h-4 w-4" />
      </td>
      <td className="px-3 py-2">
        <Button size="sm" variant="primary" loading={adding} onClick={handleAdd}>Add</Button>
      </td>
    </tr>
  );
}

function EditLineRow({ line, itemMap, uoms, onSave, onDelete }: {
  line: BOMLine;
  itemMap: Map<string, Item>;
  uoms: UOM[];
  onSave: (id: string, patch: Partial<BOMLine>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(line.qty));
  const [uomId, setUomId] = useState(line.uomId);
  const [scrap, setScrap] = useState(String(line.scrapPct));
  const [phantom, setPhantom] = useState(line.isPhantom);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const child = itemMap.get(line.childItemId);
  const uom = uoms.find(u => u.id === line.uomId);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      await onSave(line.id, { qty: Number(qty), uom_id: uomId, scrap_pct: Number(scrap), is_phantom: phantom } as never);
      setEditing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!confirm(`Remove ${child?.code ?? line.childItemId}?`)) return;
    setSaving(true);
    try { await onDelete(line.id); } catch (e) { setErr(e instanceof Error ? e.message : "Delete failed"); setSaving(false); }
  }

  if (editing) {
    return (
      <tr className="border-b border-line bg-accent-soft/5">
        <td className="px-3 py-2 font-mono text-xs">{child?.code ?? line.childItemId.slice(0, 8)}</td>
        <td className="px-3 py-2 text-xs">{child?.name ?? "—"}</td>
        <td className="px-3 py-2"><Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="0.001" step="any" className="h-8 w-20 text-xs font-mono" /></td>
        <td className="px-3 py-2">
          <select value={uomId} onChange={(e) => setUomId(e.target.value)}
            className="h-8 w-20 rounded-sm border border-line bg-surface px-2 text-xs focus:border-accent focus:outline-none">
            {uoms.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}
          </select>
        </td>
        <td className="px-3 py-2"><Input value={scrap} onChange={(e) => setScrap(e.target.value)} type="number" min="0" step="any" className="h-8 w-16 text-xs font-mono" /></td>
        <td className="px-3 py-2 text-center"><input type="checkbox" checked={phantom} onChange={(e) => setPhantom(e.target.checked)} className="h-4 w-4" /></td>
        <td className="px-3 py-2">
          {err && <p className="text-[10px] text-danger">{err}</p>}
          <div className="flex gap-1">
            <Button size="sm" variant="primary" loading={saving} onClick={save}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-line hover:bg-surface-2">
      <td className="px-3 py-2 font-mono text-xs text-ink">{child?.code ?? line.childItemId.slice(0, 8)}</td>
      <td className="px-3 py-2 text-sm text-ink">{child?.name ?? "—"}</td>
      <td className="px-3 py-2 font-mono text-sm text-ink">{line.qty}</td>
      <td className="px-3 py-2 text-xs text-ink-2">{uom?.code ?? "—"}</td>
      <td className="px-3 py-2 font-mono text-xs text-ink-2">{line.scrapPct > 0 ? `${line.scrapPct}%` : "—"}</td>
      <td className="px-3 py-2 text-center">{line.isPhantom ? <span className="text-xs text-accent">●</span> : <span className="text-xs text-ink-3">○</span>}</td>
      <td className="px-3 py-2">
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="ghost" onClick={del} disabled={saving}>✕</Button>
        </div>
      </td>
    </tr>
  );
}

interface BomTreeProps {
  bom: BOMHeader;
  uoms: UOM[];
  onChange: () => void;
}

export function BomTree({ bom: initialBom, uoms, onChange }: BomTreeProps) {
  const [bom, setBom] = useState<BOMHeader>(initialBom);
  const [lines, setLines] = useState<BOMLine[]>(initialBom.lines ?? []);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [activating, setActivating] = useState(false);
  const [actErr, setActErr] = useState<string | null>(null);

  // Explode
  const [explodeQty, setExplodeQty] = useState("1");
  const [explodeRows, setExplodeRows] = useState<BomExplodeRow[]>([]);
  const [exploding, setExploding] = useState(false);
  const [explodeErr, setExplodeErr] = useState<string | null>(null);

  // Build item map from lines
  useEffect(() => {
    const ids = [...new Set(lines.map(l => l.childItemId))];
    const missing = ids.filter(id => !itemMap.has(id));
    if (missing.length === 0) return;
    void (async () => {
      try {
        const res = await listItems({ limit: 500 });
        setItemMap(new Map(res.items.map(i => [i.id, i])));
      } catch { /* noop */ }
    })();
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    try {
      const fresh = await getBom(bom.id);
      setBom(fresh);
      if (fresh.lines) setLines(fresh.lines);
    } catch { /* noop */ }
  }, [bom.id]);

  async function handleActivate() {
    setActivating(true);
    setActErr(null);
    try {
      await activateBom(bom.id);
      await refresh();
      onChange();
    } catch (err) {
      setActErr(err instanceof Error ? err.message : "Activate failed");
    } finally {
      setActivating(false);
    }
  }

  async function handleAddLine(line: Parameters<typeof addBomLine>[1]) {
    const nl = await addBomLine(bom.id, line);
    setLines(prev => [...prev, nl]);
  }

  async function handleSaveLine(id: string, patch: Partial<BOMLine>) {
    const updated = await updateBomLine(id, patch as Parameters<typeof updateBomLine>[1]);
    setLines(prev => prev.map(l => l.id === id ? updated : l));
  }

  async function handleDeleteLine(id: string) {
    await deleteBomLine(id);
    setLines(prev => prev.filter(l => l.id !== id));
  }

  async function handleExplode() {
    setExploding(true);
    setExplodeErr(null);
    try {
      const rows = await explodeBom(bom.itemId, Number(explodeQty));
      setExplodeRows(rows);
    } catch (err) {
      setExplodeErr(err instanceof Error ? err.message : "Explode failed");
    } finally {
      setExploding(false);
    }
  }

  return (
    <div className="rounded-md border border-line bg-paper">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <span className="text-xs text-ink-3">Version {bom.version}</span>
        <BomStatusTag status={bom.status} />
        {bom.isDefault && <Tag tone="accent">Default</Tag>}
        {bom.effectiveFrom && <span className="text-xs text-ink-3">From: {new Date(bom.effectiveFrom).toLocaleDateString()}</span>}
        {bom.effectiveTo && <span className="text-xs text-ink-3">To: {new Date(bom.effectiveTo).toLocaleDateString()}</span>}
        <div className="ml-auto flex gap-2">
          {bom.status === "draft" && (
            <Button size="sm" variant="primary" loading={activating} onClick={handleActivate}>Activate</Button>
          )}
        </div>
      </div>
      {actErr && <p className="px-4 py-2 text-xs text-danger">{actErr}</p>}
      {bom.notes && <p className="px-4 py-2 text-xs text-ink-3">{bom.notes}</p>}

      {/* Lines table */}
      <div className="overflow-auto">
        <table className="w-full text-sm" data-testid="bom-lines-table">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
              <th className="px-3 py-2">Child Code</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Qty</th>
              <th className="px-3 py-2">UOM</th>
              <th className="px-3 py-2">Scrap %</th>
              <th className="px-3 py-2 text-center">Phantom</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(line => (
              <EditLineRow key={line.id} line={line} itemMap={itemMap} uoms={uoms} onSave={handleSaveLine} onDelete={handleDeleteLine} />
            ))}
            <AddLineRow uoms={uoms} onAdd={handleAddLine} />
          </tbody>
        </table>
      </div>

      {/* Explode section */}
      <div className="border-t border-line px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-ink-2">Multi-level explode @ qty</span>
          <Input value={explodeQty} onChange={(e) => setExplodeQty(e.target.value)} type="number" min="1" step="1" className="h-8 w-20 text-xs font-mono" />
          <Button size="sm" variant="ghost" loading={exploding} onClick={handleExplode}>Explode</Button>
        </div>
        {explodeErr && <p className="mt-2 text-xs text-danger">{explodeErr}</p>}
        {explodeRows.length > 0 && (
          <div className="mt-3 overflow-auto rounded-sm border border-line">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left font-medium text-ink-3">
                  <th className="px-3 py-2">Lv</th>
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Qty</th>
                  <th className="px-3 py-2">UOM</th>
                </tr>
              </thead>
              <tbody>
                {explodeRows.map((row, i) => (
                  <tr key={i} className="border-b border-line">
                    <td className="px-3 py-1 text-ink-3" style={{ paddingLeft: `${(row.level * 12) + 12}px` }}>{row.level}</td>
                    <td className="px-3 py-1 font-mono">{row.itemCode}</td>
                    <td className="px-3 py-1">{row.itemName}</td>
                    <td className="px-3 py-1 font-mono">{row.qty}</td>
                    <td className="px-3 py-1">{row.uomCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
