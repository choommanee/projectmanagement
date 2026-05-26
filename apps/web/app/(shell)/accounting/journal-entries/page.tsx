"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Input, Tag, Dialog } from "@pmplatform/ui-kit";
import {
  listJournalEntries, createJournalEntry, getJournalEntry, postJournalEntry,
  addJELine, deleteJELine, listAccounts,
  type JournalEntry, type JournalLine, type JEStatus, type ChartOfAccount,
} from "@/lib/api/accounting";

const JE_STATUSES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "draft", label: "Draft" },
  { value: "posted", label: "Posted" },
  { value: "void", label: "Void" },
];

function statusTone(s: JEStatus): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (s === "draft")  return "neutral";
  if (s === "posted") return "success";
  if (s === "void")   return "danger";
  return "neutral";
}

// ─── New JE Dialog ──────────────────────────────────────────────────────────

function NewJEDialog({
  open, onClose, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (je: JournalEntry) => void;
}) {
  const [form, setForm] = useState({ ref_no: "", memo: "", entry_date: new Date().toISOString().split("T")[0] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ ref_no: "", memo: "", entry_date: new Date().toISOString().split("T")[0] });
      setError(null);
    }
  }, [open]);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const je = await createJournalEntry({
        ref_no: form.ref_no || undefined,
        memo: form.memo || undefined,
        entry_date: form.entry_date || undefined,
      });
      onCreated(je);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create journal entry");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New Journal Entry"
      description="Create a draft journal entry"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>Create JE</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <p role="alert" className="rounded-xs bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Ref No</label>
            <Input value={form.ref_no} onChange={(e) => setForm(f => ({ ...f, ref_no: e.target.value }))} placeholder="JE-2026-001" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-2">Entry Date</label>
            <Input type="date" value={form.entry_date} onChange={(e) => setForm(f => ({ ...f, entry_date: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-2">Memo</label>
          <Input value={form.memo} onChange={(e) => setForm(f => ({ ...f, memo: e.target.value }))} placeholder="Optional description" />
        </div>
      </form>
    </Dialog>
  );
}

// ─── Add Line Row ──────────────────────────────────────────────────────────

function AddLineRow({
  entryId, accounts, onAdded,
}: {
  entryId: string;
  accounts: ChartOfAccount[];
  onAdded: (line: JournalLine) => void;
}) {
  const [form, setForm] = useState({ account_id: "", debit: "0", credit: "0", memo: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!form.account_id) { setError("Account required"); return; }
    setLoading(true);
    setError(null);
    try {
      const line = await addJELine(entryId, {
        account_id: form.account_id,
        debit: Number(form.debit) || 0,
        credit: Number(form.credit) || 0,
        memo: form.memo,
      });
      onAdded(line);
      setForm({ account_id: "", debit: "0", credit: "0", memo: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add line");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <tr className="border-b border-line bg-surface-2/50">
        <td className="px-3 py-1 text-xs text-ink-3">new</td>
        <td className="px-3 py-1">
          <select
            value={form.account_id}
            onChange={(e) => setForm(f => ({ ...f, account_id: e.target.value }))}
            className="h-7 w-full rounded-xs border border-line bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none"
          >
            <option value="">— select account —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </td>
        <td className="px-3 py-1">
          <input
            type="number" min="0" step="0.01" value={form.debit}
            onChange={(e) => setForm(f => ({ ...f, debit: e.target.value }))}
            className="h-7 w-28 rounded-xs border border-line bg-surface px-2 text-right font-mono text-xs text-ink focus:border-accent focus:outline-none"
          />
        </td>
        <td className="px-3 py-1">
          <input
            type="number" min="0" step="0.01" value={form.credit}
            onChange={(e) => setForm(f => ({ ...f, credit: e.target.value }))}
            className="h-7 w-28 rounded-xs border border-line bg-surface px-2 text-right font-mono text-xs text-ink focus:border-accent focus:outline-none"
          />
        </td>
        <td className="px-3 py-1">
          <input
            value={form.memo}
            onChange={(e) => setForm(f => ({ ...f, memo: e.target.value }))}
            placeholder="Memo"
            className="h-7 w-full rounded-xs border border-line bg-surface px-2 text-xs text-ink focus:border-accent focus:outline-none"
          />
        </td>
        <td className="px-3 py-1">
          <button
            onClick={() => void add()}
            disabled={loading}
            className="rounded-xs bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {loading ? "..." : "Add"}
          </button>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={6} className="px-3 py-1 text-xs text-danger">{error}</td>
        </tr>
      )}
    </>
  );
}

// ─── JE Detail Panel ──────────────────────────────────────────────────────────

function JEDetail({
  je: initialJe, accounts, onStatusChanged,
}: {
  je: JournalEntry;
  accounts: ChartOfAccount[];
  onStatusChanged: (je: JournalEntry) => void;
}) {
  const [je, setJe] = useState(initialJe);
  const [addingLine, setAddingLine] = useState(false);
  const [postLoading, setPostLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setJe(initialJe); }, [initialJe]);

  async function handlePost() {
    setPostLoading(true);
    setError(null);
    try {
      const updated = await postJournalEntry(je.id);
      setJe(updated);
      onStatusChanged(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to post entry");
    } finally {
      setPostLoading(false);
    }
  }

  async function removeLine(lineId: string) {
    try {
      await deleteJELine(je.id, lineId);
      setJe(prev => ({ ...prev, lines: prev.lines.filter(l => l.id !== lineId) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete line");
    }
  }

  const totalDebit = je.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = je.lines.reduce((s, l) => s + l.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001;

  return (
    <div className="flex flex-col gap-0 overflow-auto">
      {/* Header */}
      <div className="border-b border-line bg-surface-2 px-4 py-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold text-ink">{je.refNo || je.id.slice(0, 8)}</span>
              <Tag tone={statusTone(je.status)}>{je.status}</Tag>
            </div>
            <div className="mt-1 text-xs text-ink-2">{je.memo || "—"}</div>
          </div>
          {je.status === "draft" && (
            <button
              onClick={() => void handlePost()}
              disabled={postLoading || !balanced || je.lines.length === 0}
              className="rounded-xs border border-success px-3 py-1 text-xs font-medium text-success hover:bg-success/10 disabled:opacity-40 disabled:cursor-not-allowed"
              title={!balanced ? "Debits must equal credits" : "Post this entry"}
            >
              {postLoading ? "Posting..." : "Post"}
            </button>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-4 text-xs">
          <div>
            <span className="text-ink-3">Entry Date</span>
            <div className="font-mono text-ink">
              {je.entryDate ? new Date(je.entryDate).toLocaleDateString() : "—"}
            </div>
          </div>
          <div>
            <span className="text-ink-3">Total Debit</span>
            <div className={`font-mono font-semibold ${balanced ? "text-ink" : "text-danger"}`}>
              {totalDebit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
          <div>
            <span className="text-ink-3">Total Credit</span>
            <div className={`font-mono font-semibold ${balanced ? "text-ink" : "text-danger"}`}>
              {totalCredit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>
        {!balanced && je.lines.length > 0 && (
          <p className="mt-1 text-xs text-danger">Debits and credits are not balanced.</p>
        )}
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>

      {/* Lines */}
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-between px-4 py-2 text-xs font-medium text-ink-3">
          <span>Lines ({je.lines.length})</span>
          {je.status === "draft" && (
            <button
              onClick={() => setAddingLine(a => !a)}
              className="rounded-xs px-2 py-1 text-xs text-accent hover:bg-accent/10"
            >
              {addingLine ? "Cancel" : "+ Add Line"}
            </button>
          )}
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2">Memo</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {je.lines.map((l) => {
              const acct = accounts.find(a => a.id === l.accountId);
              return (
                <tr key={l.id} className="border-b border-line hover:bg-surface-2">
                  <td className="px-3 py-2 font-mono text-ink-3">{l.lineNo}</td>
                  <td className="px-3 py-2 font-mono text-ink">
                    {acct ? `${acct.code} — ${acct.name}` : (l.accountCode || l.accountId.slice(0, 8))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink">
                    {l.debit > 0 ? l.debit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-ink">
                    {l.credit > 0 ? l.credit.toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                  </td>
                  <td className="px-3 py-2 text-ink-2">{l.memo || "—"}</td>
                  <td className="px-3 py-2">
                    {je.status === "draft" && (
                      <button
                        onClick={() => void removeLine(l.id)}
                        className="text-ink-3 hover:text-danger"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {addingLine && (
              <AddLineRow
                entryId={je.id}
                accounts={accounts}
                onAdded={(line) => {
                  setJe(prev => ({ ...prev, lines: [...prev.lines, line] }));
                  setAddingLine(false);
                }}
              />
            )}
            {je.lines.length === 0 && !addingLine && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-xs text-ink-3">
                  No lines yet. Click "+ Add Line" to begin.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function JournalEntriesPage() {
  const router = useRouter();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<JournalEntry | null>(null);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, acctList] = await Promise.all([
        listJournalEntries({ status: statusFilter as JEStatus | undefined }),
        accounts.length === 0 ? listAccounts() : Promise.resolve(accounts),
      ]);
      setEntries(res.items);
      setTotal(res.total);
      if (accounts.length === 0) setAccounts(acctList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load journal entries");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, accounts]);

  useEffect(() => { void load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSelect(je: JournalEntry) {
    try {
      const full = await getJournalEntry(je.id);
      setSelected(full);
    } catch {
      setSelected(je);
    }
  }

  function handleCreated(je: JournalEntry) {
    setNewOpen(false);
    setEntries(prev => [je, ...prev]);
    void handleSelect(je);
  }

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Accounting Hub", href: "/accounting/home" }, { label: "General Ledger" }, { label: "Journal Entries" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New JE", variant: "primary", onClick: () => setNewOpen(true) },
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      {/* Status filter bar */}
      <div className="flex items-center gap-1 border-b border-line bg-paper px-4 py-2">
        {JE_STATUSES.map(t => (
          <button
            key={t.value}
            onClick={() => setStatusFilter(t.value)}
            className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-ink-3">{total} entries</span>
      </div>

      {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {/* List + Detail split */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left: JE list */}
        <div className="w-72 flex-shrink-0 overflow-y-auto border-r border-line">
          {loading && !entries.length ? (
            <div className="space-y-px">
              {[1, 2, 3, 4, 5].map(i => <div key={i} className="h-14 animate-pulse border-b border-line bg-surface-2" />)}
            </div>
          ) : (
            <ul>
              {entries.map((je) => (
                <li
                  key={je.id}
                  onClick={() => router.push('/accounting/journal-entries/' + je.id)}
                  className={`cursor-pointer border-b border-line px-3 py-3 hover:bg-surface-2 ${selected?.id === je.id ? "bg-accent/5 border-l-2 border-l-accent" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-ink">
                      {je.refNo || je.id.slice(0, 8)}
                    </span>
                    <Tag tone={statusTone(je.status)}>{je.status}</Tag>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-ink-2">{je.memo || "—"}</div>
                  <div className="mt-0.5 text-xs text-ink-3">
                    {je.entryDate ? new Date(je.entryDate).toLocaleDateString() : "—"}
                  </div>
                </li>
              ))}
              {!loading && entries.length === 0 && (
                <li className="px-4 py-8 text-center text-xs text-ink-3">No journal entries.</li>
              )}
            </ul>
          )}
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-auto">
          {selected ? (
            <JEDetail
              je={selected}
              accounts={accounts}
              onStatusChanged={(updated) => {
                setSelected(updated);
                setEntries(prev => {
                  const idx = prev.findIndex(e => e.id === updated.id);
                  if (idx >= 0) { const n = [...prev]; n[idx] = updated; return n; }
                  return prev;
                });
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-ink-3">
              Select a journal entry to view details
            </div>
          )}
        </div>
      </div>

      <NewJEDialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
