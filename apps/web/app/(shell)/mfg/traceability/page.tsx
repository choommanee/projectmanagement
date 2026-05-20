"use client";
import { useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import { listItems, listLotsForItem, type Item, type Lot, type LotStatus } from "@/lib/api/mfg";

type TraceDirection = "forward" | "backward";

interface TraceNode {
  lot_id: string;
  lot_no: string;
  item_id: string;
  item_code: string;
  qty: number;
  status: LotStatus;
  depth: number;
  children?: TraceNode[];
}

function lotStatusTone(s: LotStatus): "success" | "warning" | "danger" | "neutral" {
  if (s === "released") return "success";
  if (s === "hold") return "warning";
  if (s === "quarantine") return "danger";
  return "neutral";
}

function flattenTree(node: TraceNode, result: TraceNode[] = []): TraceNode[] {
  result.push(node);
  if (node.children) { for (const c of node.children) flattenTree(c, result); }
  return result;
}

const DEPTH_PL = [
  "pl-4", "pl-10", "pl-16", "pl-24", "pl-32",
  "pl-40", "pl-48", "pl-56", "pl-64", "pl-72", "pl-80",
] as const;

function TraceNodeRow({ node }: { node: TraceNode }) {
  const isRoot = node.depth === 0;
  const depthClass = DEPTH_PL[Math.min(node.depth, DEPTH_PL.length - 1)];
  return (
    <div
      className={`flex items-center gap-2 border-b border-line py-2 pr-4 ${depthClass} ${isRoot ? "bg-accent-soft/10 border-l-2 border-l-accent" : "hover:bg-surface-2"}`}
    >
      {node.depth > 0 && (
        <span className="text-ink-3 font-mono text-xs select-none">└</span>
      )}
      <span className="font-mono text-xs font-semibold text-ink">{node.lot_no || node.lot_id.slice(0, 8)}</span>
      {node.item_code && <span className="font-mono text-xs text-ink-2">{node.item_code}</span>}
      <span className="font-mono text-xs text-ink-3">qty: {node.qty}</span>
      <Tag tone={lotStatusTone(node.status)}>{node.status}</Tag>
      <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-mono text-ink-3">depth {node.depth}</span>
    </div>
  );
}

function AddDownstreamDialog({ currentLotId, items, onClose, onLinked }: {
  currentLotId: string;
  items: Item[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const [childItemQuery, setChildItemQuery] = useState("");
  const [childItemResults, setChildItemResults] = useState<Item[]>([]);
  const [childItemId, setChildItemId] = useState("");
  const [childLots, setChildLots] = useState<Lot[]>([]);
  const [childLotId, setChildLotId] = useState("");
  const [qty, setQty] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchItem(q: string) {
    if (!q.trim()) { setChildItemResults([]); return; }
    try { const r = await listItems({ q, limit: 10 }); setChildItemResults(r.items); } catch { /* noop */ }
  }

  async function selectItem(it: Item) {
    setChildItemId(it.id);
    setChildItemQuery(`${it.code} — ${it.name}`);
    setChildItemResults([]);
    try { setChildLots(await listLotsForItem(it.id)); } catch { setChildLots([]); }
  }

  async function link() {
    if (!childLotId) { setError("Select a child lot to link"); return; }
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/mfg/lots/${childLotId}/genealogy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parent_lot_id: currentLotId, qty: Number(qty) }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as Record<string, string>;
        throw new Error(e.error ?? `Failed: ${r.status}`);
      }
      onLinked();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to link"); }
    finally { setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-md border border-line bg-paper shadow-pop" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-ink">Add Downstream Lot</h2>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink">✕</button>
        </div>
        <div className="space-y-4 p-4">
          {error && <p className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
          <p className="text-xs text-ink-3">Select a child item + lot that was produced from the current lot (parent: {currentLotId.slice(0, 8)}).</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Child Item</label>
            <div className="relative">
              <Input value={childItemQuery} onChange={e => { setChildItemQuery(e.target.value); void searchItem(e.target.value); }} placeholder="Search item…" />
              {childItemResults.length > 0 && (
                <ul className="absolute left-0 top-full z-30 mt-1 w-full rounded-sm border border-line bg-surface shadow-pop">
                  {childItemResults.map(it => (
                    <li key={it.id} className="cursor-pointer px-3 py-1.5 text-xs hover:bg-surface-2" onClick={() => void selectItem(it)}>
                      <span className="font-mono">{it.code}</span> — {it.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {childLots.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-2">Child Lot</label>
              <select title="Child Lot" value={childLotId} onChange={e => setChildLotId(e.target.value)}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                <option value="">— select lot —</option>
                {childLots.map(l => <option key={l.id} value={l.id}>{l.lotNo} ({l.status})</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Qty used</label>
            <Input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} className="max-w-32" />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="button" variant="primary" loading={loading} disabled={!childLotId} onClick={link}>Link</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TraceabilityPage() {
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [selectedLot, setSelectedLot] = useState<Lot | null>(null);
  const [direction, setDirection] = useState<TraceDirection>("backward");
  const [traceNodes, setTraceNodes] = useState<TraceNode[]>([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [showAddDownstream, setShowAddDownstream] = useState(false);
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    void listItems({ limit: 500 }).then(r => setItems(r.items)).catch(() => {});
  }, []);

  async function searchItem(q: string) {
    if (!q.trim()) { setItemResults([]); return; }
    try { const r = await listItems({ q, limit: 10 }); setItemResults(r.items); } catch { /* noop */ }
  }

  async function selectItem(item: Item) {
    setSelectedItem(item);
    setItemQuery(`${item.code} — ${item.name}`);
    setItemResults([]);
    setSelectedLot(null);
    setTraceNodes([]);
    setLotsLoading(true);
    try { setLots(await listLotsForItem(item.id)); }
    catch { setLots([]); }
    finally { setLotsLoading(false); }
  }

  async function loadTrace(lot: Lot, dir: TraceDirection) {
    setSelectedLot(lot);
    setTraceLoading(true);
    setTraceError(null);
    setTraceNodes([]);
    try {
      const r = await fetch(`/api/mfg/lots/${lot.id}/trace?direction=${dir}&max_depth=10`);
      if (!r.ok) throw new Error(`Trace failed: ${r.status}`);
      const body = await r.json() as Record<string, unknown>;
      const root = (body.root ?? body) as TraceNode;
      if (root && (root.lot_id || root.lot_no)) {
        setTraceNodes(flattenTree(root));
      } else {
        // flat list fallback
        const nodes = (body.nodes ?? body.items ?? []) as TraceNode[];
        setTraceNodes(nodes);
      }
    } catch (e) {
      setTraceError(e instanceof Error ? e.message : "Trace failed");
    } finally { setTraceLoading(false); }
  }

  async function handleDirectionChange(dir: TraceDirection) {
    setDirection(dir);
    if (selectedLot) { await loadTrace(selectedLot, dir); }
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Traceability" }]} />
      <CommandBar actions={[
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: () => selectedLot && void loadTrace(selectedLot, direction) },
      ]} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="flex w-80 flex-col border-r border-line bg-surface">
          <div className="border-b border-line p-3">
            <label className="mb-1 block text-xs font-medium text-ink-2">Search Item</label>
            <div className="relative">
              <Input value={itemQuery} onChange={e => { setItemQuery(e.target.value); void searchItem(e.target.value); }} placeholder="Item code or name…" className="h-8 text-xs" />
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

          {selectedItem && (
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <div>
                <span className="font-mono text-xs font-semibold text-ink">{selectedItem.code}</span>
                <span className="ml-1 text-xs text-ink-3">{selectedItem.name}</span>
              </div>
              <button type="button" onClick={() => { setSelectedItem(null); setItemQuery(""); setLots([]); setSelectedLot(null); setTraceNodes([]); }}
                className="text-xs text-ink-3 hover:text-danger">✕</button>
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {!selectedItem && (
              <div className="flex h-full items-center justify-center p-4 text-center text-xs text-ink-3">
                Select an item to see its lots.
              </div>
            )}
            {selectedItem && lotsLoading && (
              <div className="flex h-20 items-center justify-center text-xs text-ink-3">Loading lots…</div>
            )}
            {selectedItem && !lotsLoading && lots.length === 0 && (
              <div className="p-4 text-center text-xs text-ink-3">No lots found for this item.</div>
            )}
            {lots.map(lot => (
              <div key={lot.id}
                onClick={() => void loadTrace(lot, direction)}
                className={`cursor-pointer border-b border-line px-3 py-2 hover:bg-surface-2 ${selectedLot?.id === lot.id ? "bg-accent-soft/20 border-l-2 border-l-accent" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-ink">{lot.lotNo}</span>
                  <Tag tone={lotStatusTone(lot.status)}>{lot.status}</Tag>
                </div>
                <div className="mt-0.5 flex gap-2 text-[10px] text-ink-3">
                  <span className="font-mono">qty: {lot.qtyOnHand}</span>
                  {lot.sourceWoId && <span>WO: {lot.sourceWoId.slice(0, 8)}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right panel — trace viewer */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Trace toolbar */}
          <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-2">
            <span className="text-xs font-medium text-ink-2">Direction:</span>
            {(["backward", "forward"] as TraceDirection[]).map(d => (
              <button key={d} type="button" onClick={() => void handleDirectionChange(d)}
                className={`rounded-xs px-3 py-1 text-xs font-medium capitalize transition-colors ${direction === d ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}>
                {d}
              </button>
            ))}
            {selectedLot && (
              <>
                <span className="ml-auto font-mono text-xs text-ink-3">Lot: {selectedLot.lotNo}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowAddDownstream(true)}>+ Add Downstream</Button>
              </>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {!selectedLot && (
              <div className="flex h-full items-center justify-center p-8 text-center">
                <div className="rounded-md border border-dashed border-line-strong bg-surface p-8 max-w-sm">
                  <p className="text-sm font-medium text-ink">No lot selected</p>
                  <p className="mt-1 text-xs text-ink-3">Select an item from the left panel, then click a lot to view its trace.</p>
                </div>
              </div>
            )}
            {traceLoading && (
              <div className="flex h-32 items-center justify-center text-sm text-ink-3">Loading trace…</div>
            )}
            {traceError && (
              <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{traceError}</div>
            )}
            {!traceLoading && !traceError && traceNodes.length > 0 && (
              <div className="divide-y divide-line">
                {traceNodes.map((node, i) => (
                  <TraceNodeRow key={`${node.lot_id}-${i}`} node={node} />
                ))}
              </div>
            )}
            {!traceLoading && !traceError && selectedLot && traceNodes.length === 0 && (
              <div className="flex h-32 items-center justify-center text-sm text-ink-3">
                No trace data found for this lot in the {direction} direction.
              </div>
            )}
          </div>
        </div>
      </div>

      {showAddDownstream && selectedLot && (
        <AddDownstreamDialog
          currentLotId={selectedLot.id}
          items={items}
          onClose={() => setShowAddDownstream(false)}
          onLinked={() => {
            setShowAddDownstream(false);
            void loadTrace(selectedLot, direction);
          }}
        />
      )}
    </div>
  );
}
