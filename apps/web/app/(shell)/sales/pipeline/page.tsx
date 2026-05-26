"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listOpportunities, createOpportunity, updateOpportunity, listCustomers,
  type Opportunity, type OpportunityStage, type Customer,
} from "@/lib/api/sales";

const STAGES: OpportunityStage[] = ["prospect", "qualified", "proposal", "negotiation", "won", "lost"];

const STAGE_LABELS: Record<OpportunityStage, string> = {
  prospect: "Prospect", qualified: "Qualified", proposal: "Proposal",
  negotiation: "Negotiation", won: "Won", lost: "Lost",
};

const STAGE_HEADER_COLORS: Record<OpportunityStage, string> = {
  prospect: "bg-zinc-200",
  qualified: "bg-blue-200",
  proposal: "bg-indigo-200",
  negotiation: "bg-amber-200",
  won: "bg-green-200",
  lost: "bg-red-200",
};

export default function PipelinePage() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCustomerId, setNewCustomerId] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newCloseDate, setNewCloseDate] = useState("");

  useEffect(() => {
    Promise.all([
      listOpportunities({ limit: 200 }).then(r => setOpps(r.items)),
      listCustomers().then(setCustomers),
    ]).finally(() => setLoading(false));
  }, []);

  const byStage = useMemo(() => {
    const m = new Map<OpportunityStage, Opportunity[]>();
    for (const s of STAGES) m.set(s, []);
    for (const o of opps) (m.get(o.stage) ?? []).push(o);
    return m;
  }, [opps]);

  const totalPipeline = useMemo(() =>
    opps.filter(o => o.stage !== "lost").reduce((s, o) => s + o.value, 0), [opps]);

  const wonValue = useMemo(() =>
    opps.filter(o => o.stage === "won").reduce((s, o) => s + o.value, 0), [opps]);

  async function handleCreate() {
    if (!newTitle || !newCustomerId) return;
    const opp = await createOpportunity({
      title: newTitle,
      customer_id: newCustomerId,
      value: newValue ? Number(newValue) : 0,
      expected_close_date: newCloseDate || undefined,
    });
    setOpps(prev => [opp, ...prev]);
    setShowNew(false);
    setNewTitle(""); setNewCustomerId(""); setNewValue(""); setNewCloseDate("");
  }

  async function moveStage(opp: Opportunity, stage: OpportunityStage) {
    const updated = await updateOpportunity(opp.id, { stage });
    setOpps(prev => prev.map(o => o.id === updated.id ? updated : o));
  }

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Sales" }, { label: "Pipeline" }]} />

      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Total Pipeline</div>
          <div className="text-xl font-mono font-bold">{fmt(totalPipeline)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Won</div>
          <div className="text-xl font-mono font-bold text-green-600">{fmt(wonValue)}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Open Deals</div>
          <div className="text-xl font-mono font-bold">{opps.filter(o => !["won", "lost"].includes(o.stage)).length}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-muted-foreground mb-1">Win Rate</div>
          <div className="text-xl font-mono font-bold">
            {opps.filter(o => ["won", "lost"].includes(o.stage)).length === 0 ? "—" :
              Math.round(opps.filter(o => o.stage === "won").length / opps.filter(o => ["won", "lost"].includes(o.stage)).length * 100) + "%"}
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => setShowNew(true)} className="px-3 py-1.5 text-xs rounded-md bg-accent text-white hover:bg-accent/90">
          + New Opportunity
        </button>
      </div>

      {showNew && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <h3 className="text-sm font-medium">New Opportunity</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Title</label>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" placeholder="Opportunity title" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Customer</label>
              <select value={newCustomerId} onChange={e => setNewCustomerId(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background">
                <option value="">Select customer...</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Value (THB)</label>
              <input type="number" value={newValue} onChange={e => setNewValue(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" placeholder="0" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Expected Close</label>
              <input type="date" value={newCloseDate} onChange={e => setNewCloseDate(e.target.value)}
                className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90">Create</button>
            <button onClick={() => setShowNew(false)} className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted">Cancel</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-6 gap-3 overflow-x-auto">
        {STAGES.map(stage => {
          const cards = byStage.get(stage) ?? [];
          const stageTotal = cards.reduce((s, o) => s + o.value, 0);
          return (
            <div key={stage} className="min-w-[160px]">
              <div className={`rounded-t-lg px-3 py-2 ${STAGE_HEADER_COLORS[stage]}`}>
                <div className="text-xs font-semibold">{STAGE_LABELS[stage]}</div>
                <div className="text-xs text-muted-foreground">{cards.length} · {fmt(stageTotal)}</div>
              </div>
              <div className="rounded-b-lg border border-t-0 border-border bg-surface min-h-[200px] p-2 space-y-2">
                {cards.map(opp => (
                  <div key={opp.id} className="rounded border border-border bg-paper p-2 space-y-1">
                    <div className="text-xs font-medium leading-tight">{opp.title}</div>
                    <div className="text-xs text-muted-foreground">{opp.customerName}</div>
                    <div className="text-xs font-mono font-semibold">{fmt(opp.value)}</div>
                    {opp.expectedCloseDate && (
                      <div className="text-xs text-muted-foreground">
                        Close: {new Date(opp.expectedCloseDate).toLocaleDateString()}
                      </div>
                    )}
                    <div className="flex gap-1 pt-1">
                      {STAGES.indexOf(stage) > 0 && STAGES.indexOf(stage) < STAGES.length - 2 && (
                        <button
                          onClick={() => moveStage(opp, STAGES[STAGES.indexOf(stage) - 1])}
                          className="flex-1 text-xs py-0.5 rounded border border-border hover:bg-muted"
                        >←</button>
                      )}
                      {STAGES.indexOf(stage) < STAGES.length - 2 && (
                        <button
                          onClick={() => moveStage(opp, STAGES[STAGES.indexOf(stage) + 1])}
                          className="flex-1 text-xs py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20"
                        >→</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
