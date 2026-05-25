"use client";
import { use, useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  getRouting, listRoutingOperations, addRoutingOperation, updateRoutingOperation, deleteRoutingOperation,
  listWorkCenters, getItem,
  type RoutingHeader, type RoutingOperation, type WorkCenter, type Item, type BOMStatus,
} from "@/lib/api/mfg";

function routingStatusTone(s: BOMStatus): "success" | "neutral" | "warning" {
  if (s === "active") return "success";
  if (s === "draft") return "neutral";
  return "warning";
}

interface EditingOp {
  id: string;
  opNo: number;
  workCenterId: string;
  setupMin: number;
  runPerUnitMin: number;
  description: string;
}

export default function RoutingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [routing, setRouting] = useState<RoutingHeader | null>(null);
  const [ops, setOps] = useState<RoutingOperation[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [item, setItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add operation form
  const [showAdd, setShowAdd] = useState(false);
  const [newOp, setNewOp] = useState({ op_no: 10, work_center_id: "", setup_min: 0, run_per_unit_min: 0, description: "" });
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  // Inline edit state
  const [editingOp, setEditingOp] = useState<EditingOp | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Delete confirmation
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const wcMap = new Map(workCenters.map(w => [w.id, w]));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [routingData, opsData, wcData] = await Promise.all([
        getRouting(id),
        listRoutingOperations(id),
        listWorkCenters(),
      ]);
      setRouting(routingData);
      setOps(opsData);
      setWorkCenters(wcData);
      if (wcData.length > 0) {
        setNewOp(f => f.work_center_id === "" ? { ...f, work_center_id: wcData[0].id } : f);
      }
      if (routingData.itemId) {
        try {
          const itemData = await getItem(routingData.itemId);
          setItem(itemData);
        } catch {
          // best-effort
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load routing");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  // Auto-suggest next op_no
  useEffect(() => {
    if (ops.length > 0) {
      const maxOp = Math.max(...ops.map(o => o.opNo));
      setNewOp(f => ({ ...f, op_no: maxOp + 10 }));
    }
  }, [ops]);

  async function handleAdd() {
    setAdding(true);
    setAddErr(null);
    try {
      const op = await addRoutingOperation(id, {
        op_no: Number(newOp.op_no),
        work_center_id: newOp.work_center_id,
        setup_min: Number(newOp.setup_min),
        run_per_unit_min: Number(newOp.run_per_unit_min),
        description: newOp.description,
      });
      setOps(prev => [...prev, op].sort((a, b) => a.opNo - b.opNo));
      setShowAdd(false);
      setNewOp(f => ({ ...f, op_no: op.opNo + 10, description: "", setup_min: 0, run_per_unit_min: 0 }));
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "Failed to add operation");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(op: RoutingOperation) {
    setEditingOp({
      id: op.id,
      opNo: op.opNo,
      workCenterId: op.workCenterId,
      setupMin: op.setupMin,
      runPerUnitMin: op.runPerUnitMin,
      description: op.description,
    });
    setSaveErr(null);
  }

  async function handleSaveEdit() {
    if (!editingOp) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const updated = await updateRoutingOperation(editingOp.id, {
        op_no: editingOp.opNo,
        work_center_id: editingOp.workCenterId,
        setup_min: editingOp.setupMin,
        run_per_unit_min: editingOp.runPerUnitMin,
        description: editingOp.description,
      });
      setOps(prev => prev.map(o => o.id === editingOp.id ? updated : o).sort((a, b) => a.opNo - b.opNo));
      setEditingOp(null);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(opId: string) {
    setDeleting(true);
    try {
      await deleteRoutingOperation(opId);
      setOps(prev => prev.filter(o => o.id !== opId));
      setPendingDeleteId(null);
    } catch { /* noop */ } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-ink-3">Loading…</div>;
  if (error) return <div className="m-6 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>;
  if (!routing) return <div className="m-6 text-sm text-ink-3">Routing not found.</div>;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[
        { label: "Home", href: "/mfg/home" },
        { label: "Routings" },
        { label: `v${routing.version}` },
      ]} />
      <CommandBar actions={[
        { id: "add-op", label: "+ Add Operation", variant: "primary", onClick: () => setShowAdd(v => !v) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      {/* Header card */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-3">
        <span className="font-mono text-sm font-semibold text-ink">v{routing.version}</span>
        <Tag tone={routingStatusTone(routing.status)} dot>{routing.status}</Tag>
        {routing.isDefault && <Tag tone="accent">Default</Tag>}
        <div className="h-4 w-px bg-line" />
        {item ? (
          <>
            <span className="font-mono text-xs uppercase text-ink-2">{item.code}</span>
            <span className="text-sm text-ink-2">{item.name}</span>
          </>
        ) : (
          <span className="font-mono text-xs text-ink-3">{routing.itemId.slice(0, 8)}</span>
        )}
        <div className="h-4 w-px bg-line" />
        <span className="font-mono text-xs text-ink-3">{ops.length} operation{ops.length !== 1 ? "s" : ""}</span>
        <span className="ml-auto text-xs text-ink-3">Updated {routing.updatedAt ? new Date(routing.updatedAt).toLocaleDateString() : "—"}</span>
      </div>

      {routing.notes && (
        <div className="border-b border-line bg-surface-2 px-4 py-2 text-xs text-ink-2">{routing.notes}</div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Add operation inline form */}
        {showAdd && (
          <div className="border-b border-line bg-surface-2 p-4">
            <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-3">New Operation</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">Op No</label>
                <Input type="number" min="1" value={newOp.op_no}
                  onChange={(e) => setNewOp(f => ({ ...f, op_no: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">Work Center</label>
                <select value={newOp.work_center_id} onChange={(e) => setNewOp(f => ({ ...f, work_center_id: e.target.value }))}
                  className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15">
                  {workCenters.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">Setup min</label>
                <Input type="number" min="0" value={newOp.setup_min}
                  onChange={(e) => setNewOp(f => ({ ...f, setup_min: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">Run/unit min</label>
                <Input type="number" min="0" value={newOp.run_per_unit_min}
                  onChange={(e) => setNewOp(f => ({ ...f, run_per_unit_min: Number(e.target.value) }))} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-2">Description</label>
                <Input value={newOp.description}
                  onChange={(e) => setNewOp(f => ({ ...f, description: e.target.value }))}
                  placeholder="e.g. Drill holes" />
              </div>
            </div>
            {addErr && <p className="mt-2 text-xs text-danger">{addErr}</p>}
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="primary" loading={adding} onClick={handleAdd}>Add Operation</Button>
              <Button size="sm" variant="ghost" onClick={() => { setShowAdd(false); setAddErr(null); }}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Operations table */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
              <th className="px-4 py-2 w-16">Op No</th>
              <th className="px-4 py-2">Work Center</th>
              <th className="px-4 py-2 w-24 text-right">Setup min</th>
              <th className="px-4 py-2 w-28 text-right">Run/unit min</th>
              <th className="px-4 py-2">Description</th>
              <th className="px-4 py-2 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {ops.map(op => {
              const isEditing = editingOp?.id === op.id;
              const isPendingDelete = pendingDeleteId === op.id;
              return (
                <tr key={op.id} className={`border-b border-line ${isEditing ? "bg-accent-soft/10" : "hover:bg-surface-2"}`}>
                  {isEditing ? (
                    <>
                      <td className="px-2 py-1.5">
                        <Input type="number" value={editingOp.opNo}
                          onChange={(e) => setEditingOp(f => f ? { ...f, opNo: Number(e.target.value) } : f)}
                          className="h-7 w-16 text-xs font-mono" />
                      </td>
                      <td className="px-2 py-1.5">
                        <select value={editingOp.workCenterId}
                          onChange={(e) => setEditingOp(f => f ? { ...f, workCenterId: e.target.value } : f)}
                          className="h-7 w-full rounded-xs border border-line bg-surface px-2 text-xs focus:border-accent focus:outline-none">
                          {workCenters.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" value={editingOp.setupMin}
                          onChange={(e) => setEditingOp(f => f ? { ...f, setupMin: Number(e.target.value) } : f)}
                          className="h-7 w-20 text-right text-xs font-mono" />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input type="number" value={editingOp.runPerUnitMin}
                          onChange={(e) => setEditingOp(f => f ? { ...f, runPerUnitMin: Number(e.target.value) } : f)}
                          className="h-7 w-24 text-right text-xs font-mono" />
                      </td>
                      <td className="px-2 py-1.5 colspan-1">
                        <Input value={editingOp.description}
                          onChange={(e) => setEditingOp(f => f ? { ...f, description: e.target.value } : f)}
                          className="h-7 text-xs" />
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1">
                          <Button size="sm" variant="primary" loading={saving} onClick={handleSaveEdit}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingOp(null); setSaveErr(null); }}>✕</Button>
                        </div>
                      </td>
                    </>
                  ) : isPendingDelete ? (
                    <>
                      <td colSpan={5} className="px-4 py-2 text-xs text-ink-2">
                        Remove op <span className="font-mono font-medium">{op.opNo}</span>?
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          <Button size="sm" variant="danger" loading={deleting} onClick={() => handleDelete(op.id)}>Remove</Button>
                          <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(null)}>Cancel</Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 font-mono text-xs font-medium text-ink">{op.opNo}</td>
                      <td className="px-4 py-2 text-xs">
                        <span className="font-mono">{wcMap.get(op.workCenterId)?.code ?? op.workCenterId.slice(0, 8)}</span>
                        {wcMap.get(op.workCenterId)?.name && (
                          <span className="ml-1 text-ink-3">{wcMap.get(op.workCenterId)!.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-ink-2">{op.setupMin}</td>
                      <td className="px-4 py-2 text-right font-mono text-xs text-ink-2">{op.runPerUnitMin}</td>
                      <td className="px-4 py-2 text-sm text-ink">{op.description || <span className="text-ink-3">—</span>}</td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => startEdit(op)}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(op.id)}>✕</Button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
            {ops.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-3">
                  No operations defined. Use &quot;+ Add Operation&quot; above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {saveErr && <div className="border-t border-line bg-danger/10 px-4 py-2 text-xs text-danger">{saveErr}</div>}

        {/* Summary footer */}
        {ops.length > 0 && (
          <div className="border-t border-line bg-surface-2 px-4 py-2">
            <div className="flex gap-6 text-xs text-ink-3">
              <span>Total setup: <span className="font-mono font-medium text-ink">{ops.reduce((s, o) => s + o.setupMin, 0)} min</span></span>
              <span>Total run/unit: <span className="font-mono font-medium text-ink">{ops.reduce((s, o) => s + o.runPerUnitMin, 0)} min</span></span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
