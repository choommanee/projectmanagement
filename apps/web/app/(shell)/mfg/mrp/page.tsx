"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import { Input } from "@pmplatform/ui-kit";
import {
  listMrpRuns, createMrpRun, listMrpDemands, listMrpSupplies, listMrpActions, listItems,
  type MrpRun, type MrpDemand, type MrpSupply, type MrpAction, type MrpActionKind, type Item,
} from "@/lib/api/mfg";

function actionTone(a: MrpActionKind): "signal" | "warning" | "danger" | "neutral" {
  if (a === "release") return "signal";
  if (a === "reschedule") return "warning";
  if (a === "cancel") return "danger";
  return "neutral";
}

type RunTab = "demands" | "supplies" | "actions";

function RunDetail({ run, itemMap }: { run: MrpRun; itemMap: Map<string, Item> }) {
  const [tab, setTab] = useState<RunTab>("demands");
  const [demands, setDemands] = useState<MrpDemand[]>([]);
  const [supplies, setSupplies] = useState<MrpSupply[]>([]);
  const [actions, setActions] = useState<MrpAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Set<RunTab>>(new Set());

  const loadTab = useCallback(async (t: RunTab) => {
    if (loaded.has(t)) return;
    setLoading(true);
    setErr(null);
    try {
      if (t === "demands") { const r = await listMrpDemands(run.id); setDemands(r); }
      if (t === "supplies") { const r = await listMrpSupplies(run.id); setSupplies(r); }
      if (t === "actions") { const r = await listMrpActions(run.id); setActions(r); }
      setLoaded(prev => new Set([...prev, t]));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [run.id, loaded]);

  useEffect(() => { void loadTab(tab); }, [tab, loadTab]);

  // Reset when run changes
  useEffect(() => { setLoaded(new Set()); setDemands([]); setSupplies([]); setActions([]); }, [run.id]);
  useEffect(() => { void loadTab("demands"); }, [run.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      {/* Run header */}
      <div className="border-b border-line bg-paper px-4 py-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-ink">{run.name}</h2>
          <span className="font-mono text-xs text-ink-3">{run.runAt ? new Date(run.runAt).toLocaleString() : "—"}</span>
        </div>
        <div className="mt-2 flex gap-3 text-xs text-ink-3">
          <span><strong>{run.demandCount ?? 0}</strong> demands</span>
          <span><strong>{run.supplyCount ?? 0}</strong> supplies</span>
          <span><strong>{run.actionCount ?? 0}</strong> actions</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line bg-paper px-4">
        {(["demands", "supplies", "actions"] as RunTab[]).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`capitalize border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>

      {err && <div className="px-4 py-2 text-xs text-danger">{err}</div>}
      {loading && <div className="px-4 py-4 text-sm text-ink-3">Loading…</div>}

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Demands */}
        {tab === "demands" && !loading && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Due</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Source Ref</th>
              </tr>
            </thead>
            <tbody>
              {demands.map(d => {
                const it = itemMap.get(d.itemId);
                return (
                  <tr key={d.id} className="border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs">{it?.code ?? d.itemId.slice(0, 8)}</div>
                      <div className="text-xs text-ink-3">{it?.name ?? ""}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{d.qty}</td>
                    <td className="px-4 py-2 text-xs text-ink-3">{d.dueDate ? new Date(d.dueDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-2"><Tag tone="neutral">{d.source}</Tag></td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-3">{d.sourceRef || "—"}</td>
                  </tr>
                );
              })}
              {demands.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-3">No demands.</td></tr>}
            </tbody>
          </table>
        )}

        {/* Supplies */}
        {tab === "supplies" && !loading && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Available At</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Source Ref</th>
              </tr>
            </thead>
            <tbody>
              {supplies.map(s => {
                const it = itemMap.get(s.itemId);
                return (
                  <tr key={s.id} className="border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <div className="font-mono text-xs">{it?.code ?? s.itemId.slice(0, 8)}</div>
                      <div className="text-xs text-ink-3">{it?.name ?? ""}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{s.qty}</td>
                    <td className="px-4 py-2 text-xs text-ink-3">{s.availableAt ? new Date(s.availableAt).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-2"><Tag tone="neutral">{s.source}</Tag></td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-3">{s.sourceRef || "—"}</td>
                  </tr>
                );
              })}
              {supplies.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-ink-3">No supplies.</td></tr>}
            </tbody>
          </table>
        )}

        {/* Actions */}
        {tab === "actions" && !loading && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Entity Type</th>
                <th className="px-4 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {actions.map(a => (
                <tr key={a.id} className="border-b border-line hover:bg-surface-2">
                  <td className="px-4 py-2"><Tag tone={actionTone(a.action)}>{a.action}</Tag></td>
                  <td className="px-4 py-2 text-xs text-ink-2">{a.entityType || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink">{a.message || "—"}</td>
                </tr>
              ))}
              {actions.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-ink-3">No actions. System is balanced.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function MrpPage() {
  const [runs, setRuns] = useState<MrpRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<MrpRun | null>(null);
  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [newRunName, setNewRunName] = useState("");
  const [showNewRun, setShowNewRun] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listMrpRuns({ limit: 50 });
      setRuns(list);
      if (list.length > 0 && !selectedRun) setSelectedRun(list[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MRP runs");
    } finally {
      setLoading(false);
    }
  }, [selectedRun]);

  useEffect(() => { void loadRuns(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void listItems({ limit: 500 }).then(r => setItemMap(new Map(r.items.map(i => [i.id, i])))).catch(() => {});
  }, []);

  async function handleCreateRun() {
    if (!newRunName.trim()) { setCreateErr("Name is required"); return; }
    setCreating(true);
    setCreateErr(null);
    try {
      const created = await createMrpRun({ name: newRunName.trim() });
      setNewRunName("");
      setShowNewRun(false);
      // The create response carries no demand/supply/action counts. Re-fetch the
      // list (which is enriched with summary counts) and select the matching
      // entry so the detail header shows real counts immediately.
      const list = await listMrpRuns({ limit: 50 });
      setRuns(list);
      setSelectedRun(list.find((r) => r.id === created.id) ?? created);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : "Failed to create run");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "MRP" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New MRP Run", variant: "primary", onClick: () => setShowNewRun(v => !v) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: loadRuns },
      ]} />

      {showNewRun && (
        <div className="flex items-center gap-3 border-b border-line bg-accent-soft/10 px-4 py-3">
          <Input value={newRunName} onChange={(e) => setNewRunName(e.target.value)} placeholder="Run name (e.g. Weekly MRP - Jun 2026)" className="max-w-xs" onKeyDown={(e) => e.key === "Enter" && handleCreateRun()} />
          <Button type="button" variant="primary" size="sm" loading={creating} onClick={handleCreateRun}>Create Run</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => { setShowNewRun(false); setNewRunName(""); setCreateErr(null); }}>Cancel</Button>
          {createErr && <span className="text-xs text-danger">{createErr}</span>}
        </div>
      )}

      {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left rail */}
        <div className="flex w-72 flex-col border-r border-line bg-surface">
          <div className="border-b border-line px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">MRP Runs</span>
          </div>
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-xs text-ink-3">Loading…</div>
          ) : runs.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-ink-3">
              No runs yet. Create one above.
            </div>
          ) : (
            <ul className="flex-1 overflow-auto">
              {runs.map(run => (
                <li key={run.id}
                  className={`cursor-pointer border-b border-line px-3 py-2.5 hover:bg-surface-2 ${selectedRun?.id === run.id ? "bg-accent-soft/20 border-l-2 border-l-accent" : ""}`}
                  onClick={() => setSelectedRun(run)}>
                  <div className="font-medium text-sm text-ink truncate">{run.name}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-ink-3">
                    {run.runAt ? new Date(run.runAt).toLocaleString() : "—"}
                  </div>
                  {(run.actionCount ?? 0) > 0 && (
                    <div className="mt-1">
                      <Tag tone="signal">{run.actionCount} actions</Tag>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right pane */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {!selectedRun ? (
            <div className="flex h-full items-center justify-center text-sm text-ink-3">
              Select an MRP run from the left panel.
            </div>
          ) : (
            <RunDetail key={selectedRun.id} run={selectedRun} itemMap={itemMap} />
          )}
        </div>
      </div>
    </div>
  );
}
