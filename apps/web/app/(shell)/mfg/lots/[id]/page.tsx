"use client";
import { use, useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import {
  getLot, updateLot, getLotGenealogy, getLotTrace, getItem,
  type Lot, type LotStatus, type Item, type LotGenealogyComponent, type LotTraceNode,
} from "@/lib/api/mfg";

const LOT_STATUSES: LotStatus[] = ["released", "quarantine", "hold", "consumed"];

function lotStatusTone(s: LotStatus): "success" | "warning" | "danger" | "neutral" {
  if (s === "released") return "success";
  if (s === "quarantine") return "danger";
  if (s === "hold") return "warning";
  return "neutral";
}

type ActiveTab = "overview" | "genealogy" | "trace";

// Recursive indented tree renderer for trace data
function TraceNode({ node, depth = 0 }: { node: LotTraceNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const lotNumber = String(node.lotNumber ?? node.lot_number ?? node.lotNo ?? node.lot_no ?? "—");
  const itemId = String(node.itemId ?? node.item_id ?? "");
  const qty = node.qty != null ? Number(node.qty) : null;
  const children = (node.children ?? node.Children ?? []) as LotTraceNode[];

  return (
    <div style={{ paddingLeft: depth * 20 }}>
      <div
        className={`flex items-center gap-2 rounded-xs px-2 py-1 text-xs hover:bg-surface-2 ${children.length > 0 ? "cursor-pointer" : ""}`}
        onClick={() => children.length > 0 && setExpanded(v => !v)}
      >
        {children.length > 0 ? (
          <span className="w-3 shrink-0 font-mono text-ink-3">{expanded ? "▾" : "▸"}</span>
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <span className="font-mono font-medium text-ink">{lotNumber}</span>
        {itemId && <span className="text-ink-3">{itemId.slice(0, 8)}</span>}
        {qty != null && <span className="ml-auto font-mono text-ink-2">{qty}</span>}
      </div>
      {expanded && children.map((child, i) => (
        <TraceNode key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export default function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [lot, setLot] = useState<Lot | null>(null);
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<ActiveTab>("overview");

  // Status update state
  const [statusEditing, setStatusEditing] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<LotStatus>("released");
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusErr, setStatusErr] = useState<string | null>(null);

  // Notes editing
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // Genealogy tab
  const [genealogy, setGenealogy] = useState<LotGenealogyComponent[] | null>(null);
  const [genealogyLoading, setGenealogyLoading] = useState(false);
  const [genealogyErr, setGenealogyErr] = useState<string | null>(null);

  // Trace tab
  const [trace, setTrace] = useState<LotTraceNode | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceErr, setTraceErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const lotData = await getLot(id);
      setLot(lotData);
      setPendingStatus(lotData.status);
      setNotesValue(lotData.notes ?? "");
      if (lotData.itemId) {
        try {
          const itemData = await getItem(lotData.itemId);
          setItem(itemData);
        } catch {
          // item lookup is best-effort
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lot");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const loadGenealogy = useCallback(async () => {
    setGenealogyLoading(true);
    setGenealogyErr(null);
    try {
      const g = await getLotGenealogy(id);
      setGenealogy(g.components);
    } catch (err) {
      setGenealogyErr(err instanceof Error ? err.message : "Failed to load genealogy");
    } finally {
      setGenealogyLoading(false);
    }
  }, [id]);

  const loadTrace = useCallback(async () => {
    setTraceLoading(true);
    setTraceErr(null);
    try {
      const t = await getLotTrace(id);
      setTrace(t);
    } catch (err) {
      setTraceErr(err instanceof Error ? err.message : "Failed to load trace");
    } finally {
      setTraceLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (tab === "genealogy" && genealogy === null) void loadGenealogy();
    if (tab === "trace" && trace === null) void loadTrace();
  }, [tab, genealogy, trace, loadGenealogy, loadTrace]);

  async function handleSaveStatus() {
    if (!lot) return;
    setSavingStatus(true);
    setStatusErr(null);
    try {
      const updated = await updateLot(id, { status: pendingStatus });
      setLot(updated);
      setStatusEditing(false);
    } catch (err) {
      setStatusErr(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSavingStatus(false);
    }
  }

  async function handleSaveNotes() {
    if (!lot) return;
    setSavingNotes(true);
    try {
      const updated = await updateLot(id, { notes: notesValue });
      setLot(updated);
      setNotesEditing(false);
    } catch {
      // best effort
    } finally {
      setSavingNotes(false);
    }
  }

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-ink-3">Loading…</div>;
  if (error) return <div className="m-6 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>;
  if (!lot) return <div className="m-6 text-sm text-ink-3">Lot not found.</div>;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[
        { label: "Home", href: "/mfg/home" },
        { label: "Lots" },
        { label: lot.lotNo },
      ]} />
      <CommandBar actions={[
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      {/* Header card */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-3">
        <span className="font-mono text-base font-semibold tracking-wide text-ink">{lot.lotNo}</span>
        <Tag tone={lotStatusTone(lot.status)} dot>{lot.status}</Tag>
        <div className="h-4 w-px bg-line" />
        {item && (
          <>
            <span className="font-mono text-xs uppercase text-ink-2">{item.code}</span>
            <span className="text-sm text-ink-2">{item.name}</span>
          </>
        )}
        {!item && <span className="font-mono text-xs text-ink-3">{lot.itemId.slice(0, 8)}</span>}
        <div className="h-4 w-px bg-line" />
        <span className="font-mono text-lg font-bold text-ink">{lot.qtyOnHand}</span>
        <span className="text-xs text-ink-3">on hand</span>
        <span className="ml-auto text-xs text-ink-3">Created {lot.createdAt ? new Date(lot.createdAt).toLocaleDateString() : "—"}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-line bg-paper px-4">
        {(["overview", "genealogy", "trace"] as ActiveTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`capitalize border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* Overview Tab */}
        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Lot identifiers */}
            <div className="rounded-md border border-line bg-surface p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-3">Lot Details</h3>
              <dl className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <dt className="text-xs text-ink-3">Lot Number</dt>
                  <dd className="font-mono text-xs font-medium text-ink">{lot.lotNo}</dd>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <dt className="text-xs text-ink-3">Item</dt>
                  <dd className="font-mono text-xs text-ink">{item ? `${item.code} — ${item.name}` : lot.itemId.slice(0, 8)}</dd>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <dt className="text-xs text-ink-3">Qty on Hand</dt>
                  <dd className="font-mono text-base font-bold text-ink">{lot.qtyOnHand}</dd>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <dt className="text-xs text-ink-3">Source Work Order</dt>
                  <dd className="font-mono text-xs text-ink">{lot.sourceWoId ? lot.sourceWoId.slice(0, 8) : "—"}</dd>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <dt className="text-xs text-ink-3">Created</dt>
                  <dd className="text-xs text-ink">{lot.createdAt ? new Date(lot.createdAt).toLocaleString() : "—"}</dd>
                </div>
              </dl>
            </div>

            {/* Status & Notes */}
            <div className="space-y-4">
              <div className="rounded-md border border-line bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Status</h3>
                  {!statusEditing && (
                    <Button size="sm" variant="ghost" onClick={() => { setStatusEditing(true); setPendingStatus(lot.status); }}>Edit</Button>
                  )}
                </div>
                {statusEditing ? (
                  <div className="space-y-2">
                    <select
                      value={pendingStatus}
                      onChange={(e) => setPendingStatus(e.target.value as LotStatus)}
                      className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
                    >
                      {LOT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    {statusErr && <p className="text-xs text-danger">{statusErr}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" loading={savingStatus} onClick={handleSaveStatus}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setStatusEditing(false); setStatusErr(null); }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <Tag tone={lotStatusTone(lot.status)} dot>{lot.status}</Tag>
                )}
              </div>

              <div className="rounded-md border border-line bg-surface p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-3">Notes</h3>
                  {!notesEditing && (
                    <Button size="sm" variant="ghost" onClick={() => setNotesEditing(true)}>Edit</Button>
                  )}
                </div>
                {notesEditing ? (
                  <div className="space-y-2">
                    <textarea
                      value={notesValue}
                      onChange={(e) => setNotesValue(e.target.value)}
                      rows={4}
                      className="w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 resize-none"
                      placeholder="Add notes…"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" loading={savingNotes} onClick={handleSaveNotes}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setNotesEditing(false); setNotesValue(lot.notes ?? ""); }}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-ink">{lot.notes || <span className="text-ink-3">No notes.</span>}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Genealogy Tab */}
        {tab === "genealogy" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Component Lots</h3>
              <Button size="sm" variant="ghost" onClick={loadGenealogy}>Refresh</Button>
            </div>
            {genealogyErr && <div className="rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{genealogyErr}</div>}
            {genealogyLoading ? (
              <div className="flex h-24 items-center justify-center text-sm text-ink-3">Loading…</div>
            ) : genealogy === null ? null : genealogy.length === 0 ? (
              <div className="rounded-md border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-3">
                No component lots recorded for this lot.
              </div>
            ) : (
              <div className="rounded-md border border-line bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                      <th className="px-4 py-2">Lot Number</th>
                      <th className="px-4 py-2">Item ID</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {genealogy.map((c) => (
                      <tr key={c.lotId} className="border-b border-line hover:bg-surface-2">
                        <td className="px-4 py-2 font-mono text-xs font-medium text-ink">{c.lotNumber || "—"}</td>
                        <td className="px-4 py-2 font-mono text-xs text-ink-2">{c.itemId.slice(0, 8)}</td>
                        <td className="px-4 py-2 text-right font-mono text-sm text-ink">{c.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Trace Tab */}
        {tab === "trace" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Full Traceability Tree</h3>
              <Button size="sm" variant="ghost" onClick={loadTrace}>Refresh</Button>
            </div>
            {traceErr && <div className="rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{traceErr}</div>}
            {traceLoading ? (
              <div className="flex h-24 items-center justify-center text-sm text-ink-3">Loading…</div>
            ) : trace === null ? null : (
              <div className="rounded-md border border-line bg-surface p-3 font-mono text-xs">
                <TraceNode node={trace} depth={0} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
