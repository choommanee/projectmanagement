"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Input, Dialog } from "@pmplatform/ui-kit";
import {
  listOpportunities, createOpportunity, updateOpportunity, deleteOpportunity, listCustomers,
  type Opportunity, type OpportunityStage, type Customer,
} from "@/lib/api/sales";

const STAGES: OpportunityStage[] = ["prospect", "qualified", "proposal", "negotiation", "won", "lost"];

const STAGE_LABELS: Record<OpportunityStage, string> = {
  prospect: "Prospect", qualified: "Qualified", proposal: "Proposal",
  negotiation: "Negotiation", won: "Won", lost: "Lost",
};

const STAGE_HEADER: Record<OpportunityStage, string> = {
  prospect:    "bg-surface-2 text-ink-2 border-line",
  qualified:   "bg-info/10 text-info border-info/30",
  proposal:    "bg-accent/10 text-accent border-accent/30",
  negotiation: "bg-warning/10 text-warning border-warning/30",
  won:         "bg-success/10 text-success border-success/30",
  lost:        "bg-danger/10 text-danger border-danger/30",
};

// ── Edit opportunity dialog ─────────────────────────────────────────────────

function EditOpportunityDialog({
  opp,
  customers,
  onClose,
  onSaved,
}: {
  opp: Opportunity | null;
  customers: Customer[];
  onClose: () => void;
  onSaved: (updated: Opportunity) => void;
}) {
  const [form, setForm] = useState({
    title: "",
    stage: "prospect" as OpportunityStage,
    value: "",
    expected_close_date: "",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (opp) {
      setForm({
        title: opp.title,
        stage: opp.stage,
        value: String(opp.value),
        expected_close_date: opp.expectedCloseDate ? opp.expectedCloseDate.split("T")[0] : "",
        notes: opp.notes,
      });
      setError(null);
    }
  }, [opp]);

  if (!opp) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!opp) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await updateOpportunity(opp.id, {
        title: form.title || undefined,
        stage: form.stage,
        value: form.value ? Number(form.value) : undefined,
        expected_close_date: form.expected_close_date || undefined,
        notes: form.notes || undefined,
      });
      onSaved(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={!!opp} onClose={onClose} title="Edit Opportunity">
      <form onSubmit={submit} className="flex flex-col gap-3 p-4 min-w-[360px]">
        {error && <p className="text-sm text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Title</span>
          <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Opportunity title" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Stage</span>
          <select
            value={form.stage}
            onChange={(e) => setForm(f => ({ ...f, stage: e.target.value as OpportunityStage }))}
            className="rounded border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {STAGES.map(s => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Value (THB)</span>
          <Input type="number" value={form.value} onChange={(e) => setForm(f => ({ ...f, value: e.target.value }))} placeholder="0" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Expected Close</span>
          <Input type="date" value={form.expected_close_date} onChange={(e) => setForm(f => ({ ...f, expected_close_date: e.target.value }))} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Notes</span>
          <Input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Notes…" />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" disabled={loading}>
            {loading ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function PipelinePage() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editOpp, setEditOpp] = useState<Opportunity | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newCustomerId, setNewCustomerId] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newCloseDate, setNewCloseDate] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

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
    try {
      const opp = await createOpportunity({
        title: newTitle,
        customer_id: newCustomerId,
        value: newValue ? Number(newValue) : 0,
        expected_close_date: newCloseDate || undefined,
      });
      setOpps(prev => [opp, ...prev]);
      setShowNew(false);
      setNewTitle(""); setNewCustomerId(""); setNewValue(""); setNewCloseDate("");
    } catch (err) {
      setActionError(String(err));
    }
  }

  async function moveStage(opp: Opportunity, stage: OpportunityStage) {
    try {
      const updated = await updateOpportunity(opp.id, { stage });
      setOpps(prev => prev.map(o => o.id === updated.id ? updated : o));
    } catch (err) {
      setActionError(String(err));
    }
  }

  async function handleDelete(opp: Opportunity) {
    if (!confirm(`Delete opportunity "${opp.title}"? It will be marked as lost.`)) return;
    try {
      await deleteOpportunity(opp.id);
      setOpps(prev => prev.filter(o => o.id !== opp.id));
    } catch (err) {
      setActionError(String(err));
    }
  }

  const fmt = (n: number) => n.toLocaleString("en", { maximumFractionDigits: 0 });

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading...</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Sales" }, { label: "Pipeline" }]} />

      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Total Pipeline</div>
          <div className="text-xl font-mono font-bold text-ink">{fmt(totalPipeline)}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Won</div>
          <div className="text-xl font-mono font-bold text-success">{fmt(wonValue)}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Open Deals</div>
          <div className="text-xl font-mono font-bold text-ink">{opps.filter(o => !["won", "lost"].includes(o.stage)).length}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Win Rate</div>
          <div className="text-xl font-mono font-bold text-ink">
            {opps.filter(o => ["won", "lost"].includes(o.stage)).length === 0 ? "—" :
              Math.round(opps.filter(o => o.stage === "won").length / opps.filter(o => ["won", "lost"].includes(o.stage)).length * 100) + "%"}
          </div>
        </div>
      </div>

      {actionError && (
        <div className="rounded border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
          {actionError}
          <button className="ml-3 text-xs underline" onClick={() => setActionError(null)}>dismiss</button>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="primary" size="sm" onClick={() => setShowNew(true)}>
          + New Opportunity
        </Button>
      </div>

      {showNew && (
        <div className="rounded-lg border border-line bg-surface p-4 space-y-3">
          <h3 className="text-sm font-medium text-ink">New Opportunity</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-ink-3 block mb-1">Title</label>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface text-ink" placeholder="Opportunity title" />
            </div>
            <div>
              <label className="text-xs text-ink-3 block mb-1">Customer</label>
              <select value={newCustomerId} onChange={e => setNewCustomerId(e.target.value)}
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface text-ink">
                <option value="">Select customer...</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-ink-3 block mb-1">Value (THB)</label>
              <input type="number" value={newValue} onChange={e => setNewValue(e.target.value)}
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface text-ink" placeholder="0" />
            </div>
            <div>
              <label className="text-xs text-ink-3 block mb-1">Expected Close</label>
              <input type="date" value={newCloseDate} onChange={e => setNewCloseDate(e.target.value)}
                className="w-full text-sm border border-line rounded px-2 py-1.5 bg-surface text-ink" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" onClick={handleCreate}>Create</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowNew(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-6 gap-3 overflow-x-auto">
        {STAGES.map(stage => {
          const cards = byStage.get(stage) ?? [];
          const stageTotal = cards.reduce((s, o) => s + o.value, 0);
          return (
            <div key={stage} className="min-w-[160px]">
              <div className={`rounded-t-lg px-3 py-2 border border-b-0 ${STAGE_HEADER[stage]}`}>
                <div className="text-xs font-semibold">{STAGE_LABELS[stage]}</div>
                <div className="text-xs opacity-70">{cards.length} · {fmt(stageTotal)}</div>
              </div>
              <div className="rounded-b-lg border border-t-0 border-line bg-surface min-h-[200px] p-2 space-y-2">
                {cards.map(opp => (
                  <div key={opp.id} className="rounded border border-line bg-paper p-2 space-y-1">
                    <div className="text-xs font-medium leading-tight text-ink">{opp.title}</div>
                    <div className="text-xs text-ink-3">{opp.customerName}</div>
                    <div className="text-xs font-mono font-semibold text-ink">{fmt(opp.value)}</div>
                    {opp.expectedCloseDate && (
                      <div className="text-xs text-ink-3">
                        Close: {new Date(opp.expectedCloseDate).toLocaleDateString()}
                      </div>
                    )}
                    <div className="flex gap-1 pt-1 flex-wrap">
                      {STAGES.indexOf(stage) > 0 && STAGES.indexOf(stage) < STAGES.length - 2 && (
                        <button
                          onClick={() => moveStage(opp, STAGES[STAGES.indexOf(stage) - 1])}
                          className="flex-1 text-xs py-0.5 rounded border border-line hover:bg-surface-2 text-ink-2"
                        >
                          &larr;
                        </button>
                      )}
                      {STAGES.indexOf(stage) < STAGES.length - 2 && (
                        <button
                          onClick={() => moveStage(opp, STAGES[STAGES.indexOf(stage) + 1])}
                          className="flex-1 text-xs py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20"
                        >
                          &rarr;
                        </button>
                      )}
                      <button
                        onClick={() => setEditOpp(opp)}
                        className="text-xs px-1.5 py-0.5 rounded border border-line hover:bg-surface-2 text-ink-2"
                        title="Edit"
                      >
                        Ed
                      </button>
                      <button
                        onClick={() => handleDelete(opp)}
                        className="text-xs px-1.5 py-0.5 rounded border border-danger/40 hover:bg-danger/10 text-danger"
                        title="Delete"
                      >
                        Rm
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <EditOpportunityDialog
        opp={editOpp}
        customers={customers}
        onClose={() => setEditOpp(null)}
        onSaved={(updated) => {
          setOpps(prev => prev.map(o => o.id === updated.id ? updated : o));
          setEditOpp(null);
        }}
      />
    </div>
  );
}
