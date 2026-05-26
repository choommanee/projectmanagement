"use client";
import { useEffect, useState, useMemo } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listAccounts,
  listJournalEntries,
  groupLinesByAccount,
  type ChartOfAccount,
  type AccountType,
} from "@/lib/api/accounting";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Asset and expense accounts are debit-normal; the rest are credit-normal. */
function normalSide(type: AccountType): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function typeTone(type: AccountType): string {
  switch (type) {
    case "asset":     return "text-success";
    case "liability": return "text-danger";
    case "equity":    return "text-info";
    case "revenue":   return "text-accent";
    case "expense":   return "text-warning";
    default:          return "text-ink-2";
  }
}

// ─── tile component ──────────────────────────────────────────────────────────

function SummaryTile({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-line bg-paper px-4 py-3">
      <span className="text-xs text-ink-3">{label}</span>
      <span className={`font-mono text-lg font-semibold ${className ?? "text-ink"}`}>{value}</span>
    </div>
  );
}

// ─── inline budget cell ───────────────────────────────────────────────────────

function BudgetCell({
  accountId,
  value,
  editing,
  editValue,
  onStartEdit,
  onEditChange,
  onCommit,
  onCancel,
}: {
  accountId: string;
  value: number;
  editing: boolean;
  editValue: string;
  onStartEdit: (id: string, current: number) => void;
  onEditChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        step="0.01"
        value={editValue}
        onChange={(e) => onEditChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "Escape") onCancel();
        }}
        className="w-32 rounded-xs border border-accent bg-surface px-2 py-1 font-mono text-right text-xs text-ink focus:outline-none focus:ring-2 focus:ring-accent/20"
      />
    );
  }
  return (
    <button
      onClick={() => onStartEdit(accountId, value)}
      title="Click to edit budget"
      className="w-32 rounded-xs px-2 py-1 text-right font-mono text-xs text-ink hover:bg-surface-2 hover:ring-1 hover:ring-accent/40 focus:outline-none"
    >
      {value > 0 ? fmt(value) : <span className="text-ink-4">— set —</span>}
    </button>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

type ShowFilter = "all" | "with-budget";

export default function BudgetPage() {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilter, setShowFilter] = useState<ShowFilter>("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Fetch accounts, journal entries, and stored budgets in parallel.
      const [accts, jeResult, budgetResp] = await Promise.all([
        listAccounts(),
        listJournalEntries({ status: "posted" }),
        fetch("/api/accounting/budgets").then((r) => r.ok ? r.json() : {}),
      ]);

      setAccounts(accts);

      // Compute actuals from posted journal lines.
      const lineMap = groupLinesByAccount(jeResult.items);
      const computedActuals: Record<string, number> = {};
      for (const acct of accts) {
        const totals = lineMap.get(acct.id);
        if (!totals) { computedActuals[acct.id] = 0; continue; }
        const side = normalSide(acct.type);
        computedActuals[acct.id] =
          side === "debit"
            ? totals.debits - totals.credits
            : totals.credits - totals.debits;
      }
      setActuals(computedActuals);

      // Budgets: API may return { items: [{account_id, amount}] } or {} on 404/no data.
      const storedBudgets: Record<string, number> = {};
      if (budgetResp && typeof budgetResp === "object") {
        const rawItems: unknown[] = Array.isArray(budgetResp)
          ? budgetResp
          : (budgetResp as Record<string, unknown>).items
            ? ((budgetResp as Record<string, unknown>).items as unknown[])
            : [];
        for (const item of rawItems) {
          const b = item as Record<string, unknown>;
          const aid = String(b.account_id ?? b.accountId ?? b.accountID ?? "");
          const amt = Number(b.amount ?? b.budget ?? 0);
          if (aid) storedBudgets[aid] = amt;
        }
      }
      setBudgets(storedBudgets);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load budget data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  // ── budget editing ─────────────────────────────────────────────────────────

  function startEdit(id: string, current: number) {
    setEditingId(id);
    setEditValue(current > 0 ? String(current) : "");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  async function commitEdit() {
    if (!editingId) return;
    const amount = parseFloat(editValue) || 0;
    // Optimistic update
    setBudgets((b) => ({ ...b, [editingId]: amount }));
    setEditingId(null);
    setEditValue("");
    try {
      await fetch(`/api/accounting/budgets/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
    } catch {
      // Non-fatal: local state already updated optimistically.
    }
  }

  // ── derived values ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    if (showFilter === "with-budget") {
      return accounts.filter((a) => (budgets[a.id] ?? 0) > 0);
    }
    return accounts;
  }, [accounts, budgets, showFilter]);

  const totalBudget = useMemo(
    () => Object.values(budgets).reduce((s, v) => s + v, 0),
    [budgets],
  );
  const totalActuals = useMemo(
    () => accounts.reduce((s, a) => s + (actuals[a.id] ?? 0), 0),
    [accounts, actuals],
  );
  const totalVariance = totalBudget - totalActuals;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[
          { label: "Accounting Hub", href: "/accounting/home" },
          { label: "General Ledger" },
          { label: "Budget" },
        ]}
      />
      <CommandBar
        actions={[
          { id: "refresh", label: "Refresh", variant: "ghost", onClick: () => void load() },
        ]}
      />

      {error && (
        <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="p-4 space-y-4">
          {/* Summary tiles */}
          <div className="grid grid-cols-3 gap-3">
            <SummaryTile label="Total Budget" value={fmt(totalBudget)} />
            <SummaryTile label="Total Actuals" value={fmt(totalActuals)} />
            <SummaryTile
              label="Variance (Budget - Actual)"
              value={`${totalVariance >= 0 ? "+" : ""}${fmt(totalVariance)}`}
              className={totalVariance >= 0 ? "text-success" : "text-danger"}
            />
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <span className="text-xs text-ink-3">Show:</span>
            {(["all", "with-budget"] as ShowFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setShowFilter(f)}
                className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${
                  showFilter === f
                    ? "bg-accent text-white"
                    : "text-ink-2 hover:bg-surface-2"
                }`}
              >
                {f === "all" ? "All Accounts" : "With Budget"}
              </button>
            ))}
            <span className="ml-auto text-xs text-ink-3">
              {filtered.length} accounts
            </span>
          </div>

          {/* Table */}
          {loading ? (
            <div className="space-y-px">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-xs bg-surface-2" />
              ))}
            </div>
          ) : (
            <div className="rounded-sm border border-line overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                    <th className="px-4 py-2 w-28">Code</th>
                    <th className="px-4 py-2">Account Name</th>
                    <th className="px-4 py-2 w-24">Type</th>
                    <th className="px-4 py-2 w-36 text-right">Budget</th>
                    <th className="px-4 py-2 w-36 text-right">Actual</th>
                    <th className="px-4 py-2 w-36 text-right">Variance</th>
                    <th className="px-4 py-2 w-40">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((acct) => {
                    const budget = budgets[acct.id] ?? 0;
                    const actual = actuals[acct.id] ?? 0;
                    const variance = budget - actual;
                    const pct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
                    const over = budget > 0 && actual > budget;

                    return (
                      <tr key={acct.id} className="border-b border-line hover:bg-surface-2">
                        <td className="px-4 py-2">
                          <span className="font-mono text-xs uppercase tracking-wider text-ink-3">
                            {acct.code}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-medium text-ink">{acct.name}</td>
                        <td className="px-4 py-2">
                          <span className={`text-xs font-medium capitalize ${typeTone(acct.type)}`}>
                            {acct.type}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <BudgetCell
                            accountId={acct.id}
                            value={budget}
                            editing={editingId === acct.id}
                            editValue={editValue}
                            onStartEdit={startEdit}
                            onEditChange={setEditValue}
                            onCommit={() => void commitEdit()}
                            onCancel={cancelEdit}
                          />
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-ink-2">
                          {fmt(actual)}
                        </td>
                        <td className={`px-4 py-2 text-right font-mono text-xs ${variance >= 0 ? "text-success" : "text-danger"}`}>
                          {variance >= 0 ? "+" : ""}{fmt(variance)}
                        </td>
                        <td className="px-4 py-2">
                          {budget > 0 ? (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-surface-2 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${over ? "bg-danger" : "bg-success"}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <span className={`shrink-0 font-mono text-[10px] ${over ? "text-danger" : "text-ink-3"}`}>
                                {Math.round(pct)}%
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-ink-4">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-3">
                        No accounts found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
