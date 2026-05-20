"use client";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { ProcessFlowBar } from "@/shell/ProcessFlowBar";
import { ComingSoon } from "@/shell/ComingSoon";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  getWorkOrder, updateWorkOrder, deleteWorkOrder, releaseWorkOrder,
  listWoOperations, listWoMaterials, listItems, listWorkCenters,
  type WorkOrder, type WOOperation, type WOMaterial, type WOStatus, type WOPriority, type Item, type WorkCenter,
} from "@/lib/api/mfg";
import { Factory } from "lucide-react";

const WO_STAGES = [
  { id: "planned", label: "Planned" },
  { id: "released", label: "Released" },
  { id: "in_progress", label: "In Progress" },
  { id: "completed", label: "Completed" },
  { id: "closed", label: "Closed" },
];

function statusTone(s: WOStatus): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "planned") return "neutral";
  if (s === "released") return "info";
  if (s === "in_progress") return "accent";
  if (s === "completed") return "success";
  if (s === "closed") return "warning";
  return "danger";
}

function priorityTone(p: WOPriority): "neutral" | "info" | "warning" | "danger" {
  if (p === "low") return "neutral";
  if (p === "med") return "info";
  if (p === "high") return "warning";
  return "danger";
}

function ConfirmDialog({ title, body, onClose, onConfirm }: { title: string; body: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setLoading(true);
    setErr(null);
    try { await onConfirm(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); setLoading(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-md border border-line bg-paper p-4 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-ink">{title}</h3>
        <p className="mt-2 text-sm text-ink-2">{body}</p>
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="primary" loading={loading} onClick={go}>Confirm</Button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({ code, onClose, onConfirm }: { code: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    if (input !== code) { setErr("Code does not match"); return; }
    setLoading(true);
    try { await onConfirm(); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); setLoading(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="w-96 rounded-md border border-line bg-paper p-4 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-ink">Delete Work Order</h3>
        <p className="mt-2 text-sm text-ink-2">Type <span className="font-mono font-medium">{code}</span> to confirm.</p>
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={code} className="mt-3" />
        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="button" variant="danger" loading={loading} disabled={input !== code} onClick={go}>Delete</Button>
        </div>
      </div>
    </div>
  );
}

type ActiveTab = "general" | "operations" | "materials" | "quality" | "traceability";

export default function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<ActiveTab>("general");
  const [confirm, setConfirm] = useState<null | "release" | "start" | "complete" | "close" | "cancel" | "delete">(null);

  // Form
  const [form, setForm] = useState<Partial<WorkOrder>>({});

  // Meta
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [wcMap, setWcMap] = useState<Map<string, WorkCenter>>(new Map());
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);

  // Sub-lists
  const [ops, setOps] = useState<WOOperation[]>([]);
  const [mats, setMats] = useState<WOMaterial[]>([]);
  const [opsLoaded, setOpsLoaded] = useState(false);
  const [matsLoaded, setMatsLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [woData, itemRes, wcRes] = await Promise.all([
        getWorkOrder(id),
        listItems({ limit: 500 }),
        listWorkCenters(),
      ]);
      setWo(woData);
      setForm(woData);
      setItemMap(new Map(itemRes.items.map(i => [i.id, i])));
      const wcList = wcRes;
      setWorkCenters(wcList);
      setWcMap(new Map(wcList.map(w => [w.id, w])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load work order");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (tab === "operations" && !opsLoaded) {
      void listWoOperations(id).then(list => { setOps(list); setOpsLoaded(true); }).catch(() => {});
    }
    if (tab === "materials" && !matsLoaded) {
      void listWoMaterials(id).then(list => { setMats(list); setMatsLoaded(true); }).catch(() => {});
    }
  }, [tab, id, opsLoaded, matsLoaded]);

  function handleFormChange(key: keyof WorkOrder, value: unknown) {
    setForm(f => ({ ...f, [key]: value }));
    setDirty(true);
  }

  async function handleSave() {
    if (!wo) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await updateWorkOrder(id, {
        priority: form.priority as WOPriority,
        due_date: form.dueDate ?? null,
        notes: form.notes,
        version: wo.version,
      });
      setWo(updated);
      setForm(updated);
      setDirty(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setSaveError(msg.includes("409") || msg.includes("conflict") ? "Version conflict — reload to get latest." : msg);
    } finally {
      setSaving(false);
    }
  }

  async function handleRelease() {
    if (!wo) return;
    const updated = await releaseWorkOrder(id, wo.version);
    setWo(updated);
    setForm(updated);
    setOpsLoaded(false);
    setMatsLoaded(false);
    setConfirm(null);
  }

  async function handleStatusChange(status: WOStatus) {
    if (!wo) return;
    const updated = await updateWorkOrder(id, { status, version: wo.version });
    setWo(updated);
    setForm(updated);
    setConfirm(null);
  }

  async function handleDelete() {
    if (!wo) return;
    await deleteWorkOrder(id, wo.version);
    router.push("/mfg/work-orders");
  }

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-ink-3">Loading…</div>;
  if (error) return <div className="m-6 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>;
  if (!wo) return <div className="m-6 text-sm text-ink-3">Work order not found.</div>;

  const item = itemMap.get(wo.itemId);
  const wc = wcMap.get(wo.workCenterId ?? "");
  const isEditable = !["completed", "closed", "cancelled"].includes(wo.status);

  const commandActions = [
    { id: "save", label: dirty ? "● Save" : "Save", variant: "primary" as const, onClick: handleSave, disabled: !dirty || saving },
    { id: "sep1", kind: "separator" as const },
    ...(wo.status === "planned" ? [{ id: "release", label: "Release", variant: "ghost" as const, onClick: () => setConfirm("release") }] : []),
    ...(wo.status === "released" ? [{ id: "start", label: "Start", variant: "ghost" as const, onClick: () => setConfirm("start") }] : []),
    ...(wo.status === "in_progress" ? [{ id: "complete", label: "Complete", variant: "ghost" as const, onClick: () => setConfirm("complete") }] : []),
    ...(wo.status === "completed" ? [{ id: "close", label: "Close", variant: "ghost" as const, onClick: () => setConfirm("close") }] : []),
    ...(!["completed", "closed", "cancelled"].includes(wo.status) ? [{ id: "cancel", label: "Cancel", variant: "ghost" as const, onClick: () => setConfirm("cancel") }] : []),
    { id: "sep2", kind: "separator" as const },
    { id: "del", label: "Delete", variant: "ghost" as const, onClick: () => setConfirm("delete") },
  ];

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[
        { label: "Home", href: "/mfg/home" },
        { label: "Work Orders", href: "/mfg/work-orders" },
        { label: wo.code },
      ]} />
      <CommandBar actions={commandActions} />

      {/* Header card */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-paper px-4 py-3">
        <span className="font-mono text-sm font-semibold uppercase text-ink">{wo.code}</span>
        {item && (
          <Link href={`/mfg/items/${wo.itemId}`} className="text-sm text-accent hover:underline">
            <span className="font-mono">{item.code}</span>
            <span className="ml-1 text-ink-2">— {item.name}</span>
          </Link>
        )}
        <span className="font-mono text-sm text-ink">Qty: {wo.qty}</span>
        <Tag tone={statusTone(wo.status)} dot>{wo.status.replace("_", " ")}</Tag>
        <span className="ml-auto text-xs text-ink-3">v{wo.version}</span>
      </div>

      {saveError && <div className="border-b border-line bg-danger/10 px-4 py-2 text-xs text-danger">{saveError}</div>}

      {/* Process flow */}
      <div className="px-4 pt-3 pb-2">
        <ProcessFlowBar stages={WO_STAGES} current={wo.status === "cancelled" ? "planned" : wo.status} />
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-line bg-paper px-4">
        {(["general", "operations", "materials", "quality", "traceability"] as ActiveTab[]).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`capitalize border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {/* General Tab */}
        {tab === "general" && (
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Schedule card */}
            <div className="rounded-md border border-line bg-surface p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-3">Schedule</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-2">Start</label>
                    <Input value={wo.startAt ? new Date(wo.startAt).toLocaleDateString() : "—"} readOnly className="bg-surface-2 text-xs" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-2">End</label>
                    <Input value={wo.endAt ? new Date(wo.endAt).toLocaleDateString() : "—"} readOnly className="bg-surface-2 text-xs" />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">Due Date</label>
                  <Input
                    type="date"
                    value={form.dueDate ? form.dueDate.split("T")[0] : ""}
                    onChange={(e) => handleFormChange("dueDate", e.target.value || null)}
                    disabled={!isEditable}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">Work Center</label>
                  <select
                    title="Work Center"
                    value={form.workCenterId ?? ""}
                    onChange={(e) => handleFormChange("workCenterId", e.target.value || null)}
                    disabled={!isEditable}
                    className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none disabled:bg-surface-2 disabled:text-ink-3"
                  >
                    <option value="">— none —</option>
                    {workCenters.map(w => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-2">Priority</label>
                  <select
                    title="Priority"
                    value={form.priority ?? "med"}
                    onChange={(e) => handleFormChange("priority", e.target.value as WOPriority)}
                    disabled={!isEditable}
                    className="h-9 w-full rounded-sm border border-line bg-surface px-3 text-sm text-ink focus:border-accent focus:outline-none disabled:bg-surface-2 disabled:text-ink-3"
                  >
                    <option value="low">Low</option>
                    <option value="med">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {/* Progress card */}
              <div className="rounded-md border border-line bg-surface p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-3">Progress</h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-2">Qty Ordered</label>
                      <Input value={wo.qty} readOnly className="bg-surface-2 font-mono" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-ink-2">Qty Completed</label>
                      <Input value={wo.qtyCompleted} readOnly className="bg-surface-2 font-mono" />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-ink-2">Status</label>
                    <div className="flex items-center gap-2 h-9">
                      <Tag tone={statusTone(wo.status)} dot>{wo.status.replace("_", " ")}</Tag>
                      {wo.priority && <Tag tone={priorityTone(wo.priority)}>{wo.priority}</Tag>}
                    </div>
                  </div>
                  {wo.qty > 0 && (
                    <div>
                      <div className="mb-1 flex justify-between text-xs text-ink-3">
                        <span>Completion</span>
                        <span className="font-mono">{Math.round((wo.qtyCompleted / wo.qty) * 100)}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full bg-success transition-all"
                          data-pct={Math.min(100, Math.round((wo.qtyCompleted / wo.qty) * 100))}
                          style={{ width: `${Math.min(100, Math.round((wo.qtyCompleted / wo.qty) * 100))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes card */}
              <div className="rounded-md border border-line bg-surface p-4">
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-3">Notes</h3>
                <textarea
                  value={form.notes ?? ""}
                  onChange={(e) => handleFormChange("notes", e.target.value)}
                  disabled={!isEditable}
                  className="h-24 w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 resize-none disabled:bg-surface-2 disabled:text-ink-3"
                  placeholder="Internal notes…"
                />
              </div>
            </div>
          </div>
        )}

        {/* Operations Tab */}
        {tab === "operations" && (
          <div>
            {wo.status === "planned" && (
              <div className="mb-4 rounded-sm bg-info/10 px-4 py-3 text-sm text-info">
                Operations are populated when the work order is Released.
              </div>
            )}
            <table className="w-full rounded-md border border-line text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                  <th className="px-4 py-2">Op No</th>
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2">Work Center</th>
                  <th className="px-4 py-2">Setup min</th>
                  <th className="px-4 py-2">Run/unit min</th>
                  <th className="px-4 py-2">Qty Done</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {ops.map(op => (
                  <tr key={op.id} className="border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2 font-mono text-xs">{op.opNo}</td>
                    <td className="px-4 py-2">{op.description || "—"}</td>
                    <td className="px-4 py-2 text-xs">{wcMap.get(op.workCenterId)?.code ?? op.workCenterId.slice(0, 8)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{op.setupMin}</td>
                    <td className="px-4 py-2 font-mono text-xs">{op.runPerUnitMin}</td>
                    <td className="px-4 py-2 font-mono text-xs">{op.qtyDone}</td>
                    <td className="px-4 py-2"><Tag tone={statusTone(op.status)} dot>{op.status.replace("_", " ")}</Tag></td>
                  </tr>
                ))}
                {ops.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-ink-3">No operations.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* Materials Tab */}
        {tab === "materials" && (
          <div>
            {wo.status === "planned" && (
              <div className="mb-4 rounded-sm bg-info/10 px-4 py-3 text-sm text-info">
                Materials are snapshotted when the work order is Released.
              </div>
            )}
            <table className="w-full rounded-md border border-line text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Required</th>
                  <th className="px-4 py-2">Issued</th>
                  <th className="px-4 py-2">UOM</th>
                  <th className="px-4 py-2">Shortage</th>
                </tr>
              </thead>
              <tbody>
                {mats.map(mat => {
                  const matItem = itemMap.get(mat.itemId);
                  const shortage = mat.qtyRequired - mat.qtyIssued;
                  return (
                    <tr key={mat.id} className="border-b border-line hover:bg-surface-2">
                      <td className="px-4 py-2">
                        <div className="font-mono text-xs text-ink">{matItem?.code ?? mat.itemId.slice(0, 8)}</div>
                        <div className="text-xs text-ink-3">{matItem?.name ?? ""}</div>
                      </td>
                      <td className="px-4 py-2 font-mono text-sm">{mat.qtyRequired}</td>
                      <td className="px-4 py-2 font-mono text-sm">{mat.qtyIssued}</td>
                      <td className="px-4 py-2 text-xs text-ink-2">{mat.uomId.slice(0, 8)}</td>
                      <td className="px-4 py-2">
                        {shortage > 0 ? (
                          <Tag tone="danger">{shortage} short</Tag>
                        ) : (
                          <Tag tone="success">OK</Tag>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {mats.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-3">No materials.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* Quality Tab */}
        {tab === "quality" && (
          <ComingSoon title="Quality" description="Inspection plans and measurement records" icon={Factory} plan="Phase 2 — Plan #10" />
        )}

        {/* Traceability Tab */}
        {tab === "traceability" && (
          <ComingSoon title="Traceability" description="Lot and serial genealogy graph" icon={Factory} plan="Phase 2 — Plan #11" />
        )}
      </div>

      {/* Confirm dialogs */}
      {confirm === "release" && (
        <ConfirmDialog title="Release Work Order" body={`Release ${wo.code}? This will snapshot BOM and routing.`} onClose={() => setConfirm(null)} onConfirm={handleRelease} />
      )}
      {confirm === "start" && (
        <ConfirmDialog title="Start Work Order" body={`Mark ${wo.code} as In Progress?`} onClose={() => setConfirm(null)} onConfirm={() => handleStatusChange("in_progress")} />
      )}
      {confirm === "complete" && (
        <ConfirmDialog title="Complete Work Order" body={`Mark ${wo.code} as Completed?`} onClose={() => setConfirm(null)} onConfirm={() => handleStatusChange("completed")} />
      )}
      {confirm === "close" && (
        <ConfirmDialog title="Close Work Order" body={`Close ${wo.code}? This will lock the order.`} onClose={() => setConfirm(null)} onConfirm={() => handleStatusChange("closed")} />
      )}
      {confirm === "cancel" && (
        <ConfirmDialog title="Cancel Work Order" body={`Cancel ${wo.code}? This cannot be undone.`} onClose={() => setConfirm(null)} onConfirm={() => handleStatusChange("cancelled")} />
      )}
      {confirm === "delete" && (
        <DeleteConfirmDialog code={wo.code} onClose={() => setConfirm(null)} onConfirm={handleDelete} />
      )}
    </div>
  );
}
