"use client";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import { BomTree } from "@/components/BomTree";
import {
  getItem, updateItem, deleteItem, listUoms, listBomsForItem, createBomForItem, getBom,
  listRoutingsForItem, createRoutingForItem, addRoutingOperation, updateRoutingOperation, deleteRoutingOperation,
  listLotsForItem, createLot,
  type Item, type UOM, type BOMHeader, type RoutingHeader, type RoutingOperation, type Lot, type ItemType, type ItemStatus, type LotStatus,
  listWorkCenters, type WorkCenter,
} from "@/lib/api/mfg";

const STATUS_TONES: Record<ItemStatus, "success" | "neutral" | "warning"> = { active: "success", inactive: "neutral", obsolete: "warning" };
const TYPE_TONES: Record<ItemType, "accent" | "info" | "success" | "warning" | "neutral" | "signal"> = {
  raw: "neutral", component: "info", assembly: "accent", finished: "success", consumable: "warning", service: "signal",
};

function DeleteConfirmDialog({ code, onClose, onConfirm }: { code: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (input !== code) { setError("Code does not match"); return; }
    setLoading(true);
    try { await onConfirm(); } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-md border border-line bg-paper p-4 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-ink">Delete Item</h3>
        <p className="mt-2 text-sm text-ink-2">Type <span className="font-mono font-medium">{code}</span> to confirm deletion.</p>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={code} className="mt-3" />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={loading} onClick={confirm} disabled={input !== code}>Delete</Button>
        </div>
      </div>
    </div>
  );
}

type ActiveTab = "overview" | "boms" | "routings" | "lots";

export default function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [item, setItem] = useState<Item | null>(null);
  const [uoms, setUoms] = useState<UOM[]>([]);
  const [uomMap, setUomMap] = useState<Map<string, UOM>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [tab, setTab] = useState<ActiveTab>("overview");

  // Form state
  const [form, setForm] = useState<Partial<Item>>({});
  const [attrsText, setAttrsText] = useState("");
  const [attrsError, setAttrsError] = useState<string | null>(null);

  // BOMs
  const [boms, setBoms] = useState<BOMHeader[]>([]);
  const [selectedBom, setSelectedBom] = useState<BOMHeader | null>(null);
  const [selectedBomFull, setSelectedBomFull] = useState<BOMHeader | null>(null);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomErr, setBomErr] = useState<string | null>(null);

  // Routings
  const [routings, setRoutings] = useState<RoutingHeader[]>([]);
  const [routingLoading, setRoutingLoading] = useState(false);

  // Work Centers for routing ops
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);

  // Lots
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotLoading, setLotLoading] = useState(false);
  const [newLotForm, setNewLotForm] = useState({ lot_no: "", qty_on_hand: "1", status: "released" as LotStatus });
  const [addingLot, setAddingLot] = useState(false);
  const [showNewLot, setShowNewLot] = useState(false);
  const [lotErr, setLotErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemData, uomList, wcList] = await Promise.all([getItem(id), listUoms(), listWorkCenters()]);
      setItem(itemData);
      setForm(itemData);
      setAttrsText(JSON.stringify(itemData.attrs ?? {}, null, 2));
      setUoms(uomList);
      setUomMap(new Map(uomList.map(u => [u.id, u])));
      setWorkCenters(wcList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load item");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const loadBoms = useCallback(async () => {
    setBomLoading(true);
    setBomErr(null);
    try {
      const bomList = await listBomsForItem(id);
      setBoms(bomList);
    } catch (err) {
      setBomErr(err instanceof Error ? err.message : "Failed to load BOMs");
    } finally {
      setBomLoading(false);
    }
  }, [id]);

  const loadRoutings = useCallback(async () => {
    setRoutingLoading(true);
    try {
      const list = await listRoutingsForItem(id);
      setRoutings(list);
    } catch (err) {
      setBomErr(err instanceof Error ? err.message : "Failed to load routings");
    } finally { setRoutingLoading(false); }
  }, [id]);

  const loadLots = useCallback(async () => {
    setLotLoading(true);
    try {
      const list = await listLotsForItem(id);
      setLots(list);
    } catch (err) {
      setLotErr(err instanceof Error ? err.message : "Failed to load lots");
    } finally { setLotLoading(false); }
  }, [id]);

  useEffect(() => {
    if (tab === "boms") void loadBoms();
    if (tab === "routings") void loadRoutings();
    if (tab === "lots") void loadLots();
  }, [tab, loadBoms, loadRoutings, loadLots]);

  function handleFormChange(key: keyof Item, value: unknown) {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  }

  async function handleSave(andClose = false) {
    if (!item) return;
    setSaving(true);
    setSaveError(null);
    try {
      let attrsVal: Record<string, unknown> = item.attrs ?? {};
      if (attrsText.trim()) {
        try { attrsVal = JSON.parse(attrsText); setAttrsError(null); } catch { setAttrsError("Invalid JSON"); setSaving(false); return; }
      }
      const updated = await updateItem(id, {
        name: form.name,
        description: form.description,
        type: form.type,
        status: form.status,
        uom_id: form.uomId,
        lot_tracked: form.lotTracked,
        serial_tracked: form.serialTracked,
        attrs: attrsVal,
        version: item.version,
      });
      setItem(updated);
      setForm(updated);
      setDirty(false);
      if (andClose) router.push("/mfg/items");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      if (msg.includes("conflict") || msg.includes("409")) {
        setSaveError("Version conflict — reload the page to get the latest version.");
      } else {
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!item) return;
    await deleteItem(id, item.version);
    router.push("/mfg/items");
  }

  async function handleSelectBom(bom: BOMHeader) {
    setSelectedBom(bom);
    try {
      const bomWithLines = await getBom(bom.id);
      const lines = bomWithLines.lines ?? [];
      setSelectedBomFull({ ...bomWithLines, lines });
    } catch {
      setSelectedBomFull(bom);
    }
  }

  async function handleNewBom() {
    setBomErr(null);
    try {
      const newBom = await createBomForItem(id);
      await loadBoms();
      void handleSelectBom(newBom);
    } catch (err) {
      setBomErr(err instanceof Error ? err.message : "Failed to create BOM");
    }
  }

  async function handleNewRouting() {
    try {
      await createRoutingForItem(id);
      void loadRoutings();
    } catch { /* noop */ }
  }

  async function handleAddLot() {
    setAddingLot(true);
    setLotErr(null);
    try {
      await createLot({ item_id: id, lot_no: newLotForm.lot_no, qty_on_hand: Number(newLotForm.qty_on_hand), status: newLotForm.status });
      setShowNewLot(false);
      setNewLotForm({ lot_no: "", qty_on_hand: "1", status: "released" });
      void loadLots();
    } catch (err) {
      setLotErr(err instanceof Error ? err.message : "Failed to create lot");
    } finally {
      setAddingLot(false);
    }
  }

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-ink-3">Loading…</div>;
  if (error) return <div className="m-6 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>;
  if (!item) return <div className="m-6 text-sm text-ink-3">Item not found.</div>;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Items", href: "/mfg/items" }, { label: item.code.toUpperCase() }]} />
      <CommandBar actions={[
        { id: "save", label: dirty ? "● Save" : "Save", variant: "primary", onClick: () => handleSave(false), disabled: !dirty || saving },
        { id: "savec", label: "Save & Close", variant: "ghost", onClick: () => handleSave(true), disabled: saving },
        { id: "sep", kind: "separator" },
        { id: "del", label: "Delete", variant: "ghost", onClick: () => setShowDelete(true) },
      ]} />

      {/* Header card */}
      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-3">
        <span className="font-mono text-sm font-semibold uppercase text-ink">{item.code}</span>
        <h1 className="text-base font-semibold text-ink">{item.name}</h1>
        <Tag tone={TYPE_TONES[item.type]}>{item.type}</Tag>
        <Tag tone={STATUS_TONES[item.status]} dot>{item.status}</Tag>
        <span className="ml-auto text-xs text-ink-3">v{item.version} · Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
      </div>

      {saveError && <div className="border-b border-line bg-danger/10 px-4 py-2 text-xs text-danger">{saveError}</div>}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-line bg-paper px-4">
        {(["overview", "boms", "routings", "lots"] as ActiveTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`capitalize border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t === "boms" ? "BOMs" : t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* Overview Tab */}
        {tab === "overview" && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Basics */}
            <div className="rounded-md border border-line bg-surface p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-3">Basics</h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">Code (readonly)</label>
                  <Input value={form.code ?? ""} readOnly className="bg-surface-2" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">Name</label>
                  <Input value={form.name ?? ""} onChange={(e) => handleFormChange("name", e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">Description</label>
                  <textarea value={form.description ?? ""} onChange={(e) => handleFormChange("description", e.target.value)}
                    className="h-24 w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 resize-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">Type</label>
                  <select value={form.type ?? "component"} onChange={(e) => handleFormChange("type", e.target.value as ItemType)}
                    className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15">
                    {["raw", "component", "assembly", "finished", "consumable", "service"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {/* Tracking */}
            <div className="space-y-4">
              <div className="rounded-md border border-line bg-surface p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-3">Tracking</h3>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-2">UOM</label>
                    <select value={form.uomId ?? ""} onChange={(e) => handleFormChange("uomId", e.target.value)}
                      className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15">
                      {uoms.map(u => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-6">
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={form.lotTracked ?? false} onChange={(e) => handleFormChange("lotTracked", e.target.checked)} className="h-4 w-4" />
                      Lot Tracked
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" checked={form.serialTracked ?? false} onChange={(e) => handleFormChange("serialTracked", e.target.checked)} className="h-4 w-4" />
                      Serial Tracked
                    </label>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-2">Status</label>
                    <select value={form.status ?? "active"} onChange={(e) => handleFormChange("status", e.target.value as ItemStatus)}
                      className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15">
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="obsolete">Obsolete</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Attributes */}
              <div className="rounded-md border border-line bg-surface p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-3">Attributes (JSON)</h3>
                <textarea value={attrsText} onChange={(e) => { setAttrsText(e.target.value); setDirty(true); }}
                  className={`h-32 w-full rounded-sm border px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-3 focus:outline-none focus:ring-2 resize-none ${attrsError ? "border-danger focus:ring-danger/15" : "border-line bg-surface focus:border-accent focus:ring-accent/15"}`}
                  placeholder="{}" />
                {attrsError && <p className="mt-1 text-xs text-danger">{attrsError}</p>}
              </div>
            </div>
          </div>
        )}

        {/* BOMs Tab */}
        {tab === "boms" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Bill of Materials</h3>
              <Button size="sm" variant="primary" onClick={handleNewBom}>+ New BOM Version</Button>
            </div>
            {bomErr && <p className="text-xs text-danger">{bomErr}</p>}
            {bomLoading ? <p className="text-sm text-ink-3">Loading…</p> : (
              <>
                {boms.length === 0 && <p className="text-sm text-ink-3">No BOMs yet. Create one above.</p>}
                {boms.length > 0 && (
                  <div className="rounded-md border border-line bg-surface">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                          <th className="px-4 py-2">Version</th>
                          <th className="px-4 py-2">Status</th>
                          <th className="px-4 py-2">Default</th>
                          <th className="px-4 py-2">Effective From</th>
                          <th className="px-4 py-2">Effective To</th>
                          <th className="px-4 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {boms.map(bom => (
                          <tr key={bom.id} className={`cursor-pointer border-b border-line hover:bg-surface-2 ${selectedBom?.id === bom.id ? "bg-accent-soft/20" : ""}`}
                            onClick={() => handleSelectBom(bom)}>
                            <td className="px-4 py-2 font-mono text-xs">v{bom.version}</td>
                            <td className="px-4 py-2"><Tag tone={bom.status === "active" ? "success" : "neutral"} dot>{bom.status}</Tag></td>
                            <td className="px-4 py-2">{bom.isDefault ? <Tag tone="accent">Default</Tag> : "—"}</td>
                            <td className="px-4 py-2 text-xs text-ink-3">{bom.effectiveFrom ? new Date(bom.effectiveFrom).toLocaleDateString() : "—"}</td>
                            <td className="px-4 py-2 text-xs text-ink-3">{bom.effectiveTo ? new Date(bom.effectiveTo).toLocaleDateString() : "—"}</td>
                            <td className="px-4 py-2"><Button size="sm" variant="ghost">Open</Button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {selectedBomFull && (
                  <div className="mt-4">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-3">BOM v{selectedBomFull.version}</h4>
                    <BomTree bom={selectedBomFull} uoms={uoms} onChange={() => void loadBoms()} />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Routings Tab */}
        {tab === "routings" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Routings</h3>
              <Button size="sm" variant="primary" onClick={handleNewRouting}>+ New Routing</Button>
            </div>
            {routingLoading ? <p className="text-sm text-ink-3">Loading…</p> : (
              <div className="space-y-4">
                {routings.length === 0 && <p className="text-sm text-ink-3">No routings yet.</p>}
                {routings.map(r => (
                  <RoutingPanel key={r.id} routing={r} workCenters={workCenters} onRefresh={loadRoutings} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Lots Tab */}
        {tab === "lots" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-ink">Lots</h3>
              <Button size="sm" variant="primary" onClick={() => setShowNewLot(v => !v)}>+ New Lot</Button>
            </div>
            {showNewLot && (
              <div className="rounded-md border border-line bg-surface-2 p-4">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-2">Lot No</label>
                    <Input value={newLotForm.lot_no} onChange={(e) => setNewLotForm(f => ({ ...f, lot_no: e.target.value }))} placeholder="LOT-001" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-2">Qty on Hand</label>
                    <Input type="number" min="0" value={newLotForm.qty_on_hand} onChange={(e) => setNewLotForm(f => ({ ...f, qty_on_hand: e.target.value }))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-2">Status</label>
                    <select value={newLotForm.status} onChange={(e) => setNewLotForm(f => ({ ...f, status: e.target.value as LotStatus }))}
                      className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                      <option value="released">Released</option>
                      <option value="hold">Hold</option>
                      <option value="quarantine">Quarantine</option>
                    </select>
                  </div>
                </div>
                {lotErr && <p className="mt-2 text-xs text-danger">{lotErr}</p>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="primary" loading={addingLot} onClick={handleAddLot}>Create Lot</Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowNewLot(false)}>Cancel</Button>
                </div>
              </div>
            )}
            {lotLoading ? <p className="text-sm text-ink-3">Loading…</p> : (
              <table className="w-full rounded-md border border-line text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                    <th className="px-4 py-2">Lot No</th>
                    <th className="px-4 py-2">Qty on Hand</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {lots.map(lot => (
                    <tr key={lot.id} className="border-b border-line">
                      <td className="px-4 py-2 font-mono text-xs">{lot.lotNo}</td>
                      <td className="px-4 py-2 font-mono text-sm">{lot.qtyOnHand}</td>
                      <td className="px-4 py-2"><Tag tone={lot.status === "released" ? "success" : lot.status === "hold" ? "warning" : "danger"} dot>{lot.status}</Tag></td>
                      <td className="px-4 py-2 text-xs text-ink-3">{lot.createdAt ? new Date(lot.createdAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                  {lots.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-ink-3">No lots recorded.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {showDelete && <DeleteConfirmDialog code={item.code} onClose={() => setShowDelete(false)} onConfirm={handleDelete} />}
    </div>
  );
}

// Routing Panel component
function RoutingPanel({ routing, workCenters, onRefresh }: { routing: RoutingHeader; workCenters: WorkCenter[]; onRefresh: () => void }) {
  const [ops, setOps] = useState<RoutingOperation[]>(routing.operations ?? []);
  const [showAdd, setShowAdd] = useState(false);
  const [newOp, setNewOp] = useState({ op_no: 10, work_center_id: workCenters[0]?.id ?? "", setup_min: 0, run_per_unit_min: 0, description: "" });
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const wcMap = new Map(workCenters.map(w => [w.id, w]));

  async function handleAdd() {
    setAdding(true);
    setAddErr(null);
    try {
      const op = await addRoutingOperation(routing.id, { ...newOp, op_no: Number(newOp.op_no), setup_min: Number(newOp.setup_min), run_per_unit_min: Number(newOp.run_per_unit_min) });
      setOps(prev => [...prev, op]);
      setShowAdd(false);
      onRefresh();
    } catch (e) {
      setAddErr(e instanceof Error ? e.message : "Failed to add operation");
    } finally {
      setAdding(false);
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

  return (
    <div className="rounded-md border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex gap-2 items-center">
          <span className="text-xs font-medium text-ink-2">Routing v{routing.version}</span>
          <Tag tone={routing.status === "active" ? "success" : "neutral"} dot>{routing.status}</Tag>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowAdd(v => !v)}>+ Add Operation</Button>
      </div>
      {showAdd && (
        <div className="border-b border-line bg-surface-2 p-4">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs text-ink-2">Op No</label>
              <Input type="number" value={newOp.op_no} onChange={(e) => setNewOp(f => ({ ...f, op_no: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-2">Work Center</label>
              <select value={newOp.work_center_id} onChange={(e) => setNewOp(f => ({ ...f, work_center_id: e.target.value }))}
                className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none">
                {workCenters.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-2">Description</label>
              <Input value={newOp.description} onChange={(e) => setNewOp(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-2">Setup min</label>
              <Input type="number" value={newOp.setup_min} onChange={(e) => setNewOp(f => ({ ...f, setup_min: Number(e.target.value) }))} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-ink-2">Run/unit min</label>
              <Input type="number" value={newOp.run_per_unit_min} onChange={(e) => setNewOp(f => ({ ...f, run_per_unit_min: Number(e.target.value) }))} />
            </div>
          </div>
          {addErr && <p className="mt-2 text-xs text-danger">{addErr}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="primary" loading={adding} onClick={handleAdd}>Add Operation</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
            <th className="px-4 py-2">Op No</th>
            <th className="px-4 py-2">Work Center</th>
            <th className="px-4 py-2">Description</th>
            <th className="px-4 py-2">Setup min</th>
            <th className="px-4 py-2">Run/unit min</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {ops.map(op => (
            <tr key={op.id} className="border-b border-line hover:bg-surface-2">
              <td className="px-4 py-2 font-mono text-xs">{op.opNo}</td>
              <td className="px-4 py-2 text-xs">{wcMap.get(op.workCenterId)?.code ?? op.workCenterId.slice(0, 8)}</td>
              <td className="px-4 py-2">{op.description || "—"}</td>
              <td className="px-4 py-2 font-mono text-xs">{op.setupMin}</td>
              <td className="px-4 py-2 font-mono text-xs">{op.runPerUnitMin}</td>
              <td className="px-4 py-2">
                {pendingDeleteId === op.id ? (
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="danger" loading={deleting} onClick={() => handleDelete(op.id)}>Remove</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(null)}>Cancel</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(op.id)}>✕</Button>
                )}
              </td>
            </tr>
          ))}
          {ops.length === 0 && <tr><td colSpan={6} className="px-4 py-4 text-center text-xs text-ink-3">No operations. Add one above.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
