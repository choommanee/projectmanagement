"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import {
  getMrpRun, listMrpDemands, listMrpSupplies, listMrpActions, listItems,
  type MrpRun, type MrpDemand, type MrpSupply, type MrpAction, type MrpActionKind, type Item,
} from "@/lib/api/mfg";

function actionTone(a: MrpActionKind): "accent" | "warning" | "danger" | "neutral" {
  if (a === "release") return "accent";
  if (a === "reschedule") return "warning";
  if (a === "cancel") return "danger";
  return "neutral";
}

type ActiveTab = "actions" | "demands" | "supplies" | "params";

export default function MrpRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [run, setRun] = useState<MrpRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ActiveTab>("actions");

  const [demands, setDemands] = useState<MrpDemand[]>([]);
  const [supplies, setSupplies] = useState<MrpSupply[]>([]);
  const [actions, setActions] = useState<MrpAction[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabErr, setTabErr] = useState<string | null>(null);
  const loaded = useRef<Set<ActiveTab>>(new Set());
  const failed = useRef<Set<ActiveTab>>(new Set());

  const [itemMap, setItemMap] = useState<Map<string, Item>>(new Map());
  const [filterMsg, setFilterMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runData, itemRes] = await Promise.all([
        getMrpRun(id),
        listItems({ limit: 200 }),
      ]);
      setRun(runData);
      setItemMap(new Map(itemRes.items.map(i => [i.id, i])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load MRP run");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const loadTab = useCallback(async (t: ActiveTab) => {
    if (loaded.current.has(t) || t === "params") return;
    failed.current.delete(t);
    setTabLoading(true);
    setTabErr(null);
    try {
      if (t === "actions") { const r = await listMrpActions(id); setActions(r); }
      if (t === "demands") { const r = await listMrpDemands(id); setDemands(r); }
      if (t === "supplies") { const r = await listMrpSupplies(id); setSupplies(r); }
      loaded.current.add(t);
    } catch (e) {
      failed.current.add(t);
      setTabErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setTabLoading(false);
    }
  }, [id]);

  useEffect(() => { void loadTab(tab); }, [tab, loadTab]);

  // Load actions first on mount
  useEffect(() => { void loadTab("actions"); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="flex h-full items-center justify-center text-sm text-ink-3">Loading…</div>;
  if (error) return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "MRP", href: "/mfg/mrp" }, { label: "Run" }]} />
      <div className="m-6 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
    </div>
  );
  if (!run) return null;

  const filteredActions = filterMsg
    ? actions.filter(a => a.message.toLowerCase().includes(filterMsg.toLowerCase()) || a.entityType.toLowerCase().includes(filterMsg.toLowerCase()))
    : actions;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[
        { label: "Home", href: "/mfg/home" },
        { label: "MRP", href: "/mfg/mrp" },
        { label: run.name },
      ]} />
      <CommandBar actions={[
        { id: "back", label: "Back to MRP", variant: "ghost", onClick: () => router.push("/mfg/mrp") },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: () => { loaded.current = new Set(); failed.current = new Set(); void load(); } },
      ]} />

      {/* Header card */}
      <div className="border-b border-line bg-paper px-4 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-base font-semibold text-ink">{run.name}</h1>
          <span className="font-mono text-xs text-ink-3">{run.runAt ? new Date(run.runAt).toLocaleString() : "—"}</span>
        </div>
        <div className="mt-2 flex gap-4">
          <Tag tone="neutral">{run.demandCount ?? 0} demands</Tag>
          <Tag tone="info">{run.supplyCount ?? 0} supplies</Tag>
          <Tag tone={((run.actionCount ?? 0) > 0) ? "accent" : "neutral"}>
            {run.actionCount ?? 0} actions
          </Tag>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line bg-paper px-4">
        {(["actions", "demands", "supplies", "params"] as ActiveTab[]).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`capitalize border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${tab === t ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>

      {tabErr && (
        <div className="flex items-center gap-3 px-4 py-2 text-danger font-mono text-[11px]">
          <span>{tabErr}</span>
          <button
            type="button"
            className="rounded-sm border border-danger/40 px-2 py-1 hover:bg-danger/10"
            onClick={() => {
              failed.current.delete(tab);
              loaded.current.delete(tab);
              setTabErr(null);
              void loadTab(tab);
            }}
          >
            Retry
          </button>
        </div>
      )}
      {tabLoading && <div className="px-4 py-3 text-sm text-ink-3">Loading…</div>}

      <div className="min-h-0 flex-1 overflow-auto">
        {/* Actions tab */}
        {tab === "actions" && !tabLoading && (
          <div>
            <div className="border-b border-line bg-paper px-4 py-2">
              <input
                type="text"
                value={filterMsg}
                onChange={(e) => setFilterMsg(e.target.value)}
                placeholder="Filter by message or entity…"
                className="h-8 w-64 rounded-sm border border-line bg-surface px-3 text-xs text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Entity Type</th>
                  <th className="px-4 py-2">Entity ID</th>
                  <th className="px-4 py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {filteredActions.map(a => (
                  <tr key={a.id} className="border-b border-line hover:bg-surface-2">
                    <td className="px-4 py-2">
                      <Tag tone={actionTone(a.action)}>{a.action}</Tag>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-2">{a.entityType || "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-3">
                      {a.entityId ? a.entityId.slice(0, 8) : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink">{a.message || "—"}</td>
                  </tr>
                ))}
                {filteredActions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-sm text-ink-3">
                      {actions.length === 0 ? "No action messages — system is balanced." : "No actions match filter."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Demands tab */}
        {tab === "demands" && !tabLoading && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2">Qty</th>
                <th className="px-4 py-2">Due Date</th>
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
                      <div className="font-mono text-xs text-ink">{it?.code ?? d.itemId.slice(0, 8)}</div>
                      <div className="text-xs text-ink-3">{it?.name ?? ""}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{d.qty}</td>
                    <td className="px-4 py-2 text-xs text-ink-3">
                      {d.dueDate ? new Date(d.dueDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2"><Tag tone="neutral">{d.source}</Tag></td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-3">{d.sourceRef || "—"}</td>
                  </tr>
                );
              })}
              {demands.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-3">No demands.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {/* Supplies tab */}
        {tab === "supplies" && !tabLoading && (
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
                      <div className="font-mono text-xs text-ink">{it?.code ?? s.itemId.slice(0, 8)}</div>
                      <div className="text-xs text-ink-3">{it?.name ?? ""}</div>
                    </td>
                    <td className="px-4 py-2 font-mono text-sm">{s.qty}</td>
                    <td className="px-4 py-2 text-xs text-ink-3">
                      {s.availableAt ? new Date(s.availableAt).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-2"><Tag tone="neutral">{s.source}</Tag></td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-3">{s.sourceRef || "—"}</td>
                  </tr>
                );
              })}
              {supplies.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-3">No supplies.</td></tr>
              )}
            </tbody>
          </table>
        )}

        {/* Params tab */}
        {tab === "params" && (
          <div className="p-4">
            <div className="rounded-md border border-line bg-surface-2 p-4">
              <pre className="font-mono text-xs text-ink overflow-auto whitespace-pre-wrap">
                {run.params ? JSON.stringify(run.params, null, 2) : "{}"}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
