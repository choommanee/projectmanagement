"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";
import {
  listAccounts,
  listJournalEntries,
  groupLinesByAccount,
  type AccountType,
  type ChartOfAccount,
  type JournalEntry,
} from "@/lib/api/accounting";

// ─── constants ─────────────────────────────────────────────────────────────

const NORMAL_SIDE: Record<AccountType, "debit" | "credit"> = {
  asset:     "debit",
  liability: "credit",
  equity:    "credit",
  revenue:   "credit",
  expense:   "debit",
};

const TYPE_LABELS: Record<AccountType, string> = {
  asset:     "Assets",
  liability: "Liabilities",
  equity:    "Equity",
  revenue:   "Revenue",
  expense:   "Expenses",
};

const TABS = ["trial-balance", "balance-sheet", "pnl"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  "trial-balance":  "Trial Balance",
  "balance-sheet":  "Balance Sheet",
  "pnl":            "Profit & Loss",
};

type Period = "this-period" | "ytd" | "all";

const PERIOD_LABELS: Record<Period, string> = {
  "this-period": "This Period",
  ytd:           "Year to Date",
  all:           "All Time",
};

// ─── helpers ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function filterByPeriod(entries: JournalEntry[], period: Period): JournalEntry[] {
  if (period === "all") return entries;
  const now = new Date();
  if (period === "ytd") {
    const janFirst = `${now.getFullYear()}-01-01`;
    return entries.filter((e) => e.entryDate >= janFirst);
  }
  // this-period = current month
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `${now.getFullYear()}-${mm}`;
  return entries.filter((e) => e.entryDate.startsWith(prefix));
}

// ─── sub-components ────────────────────────────────────────────────────────

function PeriodSelector({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  return (
    <div className="flex items-center gap-px rounded-sm border border-line bg-surface-2 p-px">
      {(["this-period", "ytd", "all"] as Period[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={[
            "px-3 py-1 text-xs font-medium transition-colors",
            value === p
              ? "bg-surface text-ink shadow-sm"
              : "text-ink-3 hover:text-ink",
          ].join(" ")}
        >
          {PERIOD_LABELS[p]}
        </button>
      ))}
    </div>
  );
}

// ─── Trial Balance ─────────────────────────────────────────────────────────

function TrialBalance({
  accounts,
  balanceMap,
}: {
  accounts: ChartOfAccount[];
  balanceMap: Map<string, { debits: number; credits: number }>;
}) {
  let grandDebits = 0;
  let grandCredits = 0;

  const rows = accounts.map((a) => {
    const { debits, credits } = balanceMap.get(a.id) ?? { debits: 0, credits: 0 };
    grandDebits += debits;
    grandCredits += credits;
    const balance = NORMAL_SIDE[a.type] === "debit" ? debits - credits : credits - debits;
    return { account: a, debits, credits, balance };
  });

  const balanced = Math.abs(grandDebits - grandCredits) < 0.005;

  return (
    <div>
      {!balanced && (
        <div className="mx-4 mt-4 rounded-sm border border-danger/40 bg-danger/10 px-4 py-2 text-xs text-danger">
          Warning: Total debits ({fmt(grandDebits)}) do not equal total credits ({fmt(grandCredits)}). Check for unbalanced entries.
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
            <th className="px-4 py-2 w-24">Code</th>
            <th className="px-4 py-2">Account Name</th>
            <th className="px-4 py-2 w-20">Type</th>
            <th className="px-4 py-2 w-32 text-right">Debit</th>
            <th className="px-4 py-2 w-32 text-right">Credit</th>
            <th className="px-4 py-2 w-32 text-right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ account, debits, credits, balance }) => (
            <tr key={account.id} className="border-b border-line hover:bg-surface-2">
              <td className="px-4 py-2 font-mono text-xs uppercase text-ink-2">{account.code}</td>
              <td className="px-4 py-2 text-ink">{account.name}</td>
              <td className="px-4 py-2">
                <Tag tone={account.type === "asset" ? "success" : account.type === "liability" ? "danger" : account.type === "equity" ? "info" : account.type === "revenue" ? "accent" : "warning"}>
                  {account.type}
                </Tag>
              </td>
              <td className="px-4 py-2 font-mono tabular-nums text-right text-ink">
                {debits > 0 ? fmt(debits) : <span className="text-ink-3">—</span>}
              </td>
              <td className="px-4 py-2 font-mono tabular-nums text-right text-ink">
                {credits > 0 ? fmt(credits) : <span className="text-ink-3">—</span>}
              </td>
              <td className={[
                "px-4 py-2 font-mono tabular-nums text-right font-medium",
                balance > 0 ? "text-ink" : balance < 0 ? "text-danger" : "text-ink-3",
              ].join(" ")}>
                {fmt(balance)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line bg-surface-2 text-sm font-semibold text-ink">
            <td className="px-4 py-2" colSpan={3}>Totals</td>
            <td className={[
              "px-4 py-2 font-mono tabular-nums text-right",
              balanced ? "text-ink" : "text-danger",
            ].join(" ")}>
              {fmt(grandDebits)}
            </td>
            <td className={[
              "px-4 py-2 font-mono tabular-nums text-right",
              balanced ? "text-ink" : "text-danger",
            ].join(" ")}>
              {fmt(grandCredits)}
            </td>
            <td className="px-4 py-2 text-right">
              {balanced ? (
                <span className="font-mono text-xs text-success">BALANCED</span>
              ) : (
                <span className="font-mono text-xs text-danger">OUT OF BALANCE</span>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── Balance Sheet ─────────────────────────────────────────────────────────

function AccountRows({
  accounts,
  balanceMap,
}: {
  accounts: ChartOfAccount[];
  balanceMap: Map<string, { debits: number; credits: number }>;
}) {
  return (
    <>
      {accounts.map((a) => {
        const { debits, credits } = balanceMap.get(a.id) ?? { debits: 0, credits: 0 };
        const balance = NORMAL_SIDE[a.type] === "debit" ? debits - credits : credits - debits;
        return (
          <tr key={a.id} className="border-b border-line hover:bg-surface-2">
            <td className="pl-8 pr-4 py-2 font-mono text-xs uppercase text-ink-2">{a.code}</td>
            <td className="px-4 py-2 text-sm text-ink">{a.name}</td>
            <td className="px-4 py-2 font-mono tabular-nums text-right text-sm text-ink w-32">
              {fmt(balance)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <tr className="bg-surface-2 border-b border-line">
      <td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-2">
        {label}
      </td>
      <td />
    </tr>
  );
}

function SubtotalRow({ label, total }: { label: string; total: number }) {
  return (
    <tr className="border-b border-line border-t border-line/60">
      <td colSpan={2} className="px-4 py-2 text-sm font-semibold text-ink">{label}</td>
      <td className="px-4 py-2 font-mono tabular-nums text-right text-sm font-semibold text-ink w-32">
        {fmt(total)}
      </td>
    </tr>
  );
}

function BalanceSheet({
  accounts,
  balanceMap,
}: {
  accounts: ChartOfAccount[];
  balanceMap: Map<string, { debits: number; credits: number }>;
}) {
  const byType = (type: AccountType) => accounts.filter((a) => a.type === type);

  const calcTotal = (type: AccountType) =>
    byType(type).reduce((sum, a) => {
      const { debits, credits } = balanceMap.get(a.id) ?? { debits: 0, credits: 0 };
      return sum + (NORMAL_SIDE[type] === "debit" ? debits - credits : credits - debits);
    }, 0);

  const totalAssets = calcTotal("asset");
  const totalLiabilities = calcTotal("liability");
  const totalEquity = calcTotal("equity");
  const totalLE = totalLiabilities + totalEquity;
  const balanced = Math.abs(totalAssets - totalLE) < 0.005;

  return (
    <div className="p-4 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {/* Assets */}
        <div className="rounded-sm border border-line">
          <div className="border-b border-line bg-surface-2 px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Assets</span>
            <Tag tone="success">asset</Tag>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-xs font-medium text-ink-3">
                <th className="px-4 py-2 text-left w-20">Code</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-right w-32">Balance</th>
              </tr>
            </thead>
            <tbody>
              <SectionHeader label="Current Assets" />
              <AccountRows accounts={byType("asset")} balanceMap={balanceMap} />
              <SubtotalRow label="Total Assets" total={totalAssets} />
            </tbody>
          </table>
        </div>

        {/* Liabilities + Equity */}
        <div className="rounded-sm border border-line">
          <div className="border-b border-line bg-surface-2 px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Liabilities &amp; Equity</span>
            <div className="flex gap-1">
              <Tag tone="danger">liability</Tag>
              <Tag tone="info">equity</Tag>
            </div>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-xs font-medium text-ink-3">
                <th className="px-4 py-2 text-left w-20">Code</th>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-right w-32">Balance</th>
              </tr>
            </thead>
            <tbody>
              <SectionHeader label="Liabilities" />
              <AccountRows accounts={byType("liability")} balanceMap={balanceMap} />
              <SubtotalRow label="Total Liabilities" total={totalLiabilities} />
              <SectionHeader label="Equity" />
              <AccountRows accounts={byType("equity")} balanceMap={balanceMap} />
              <SubtotalRow label="Total Equity" total={totalEquity} />
              <SubtotalRow label="Total Liabilities + Equity" total={totalLE} />
            </tbody>
          </table>
        </div>
      </div>

      {/* Accounting equation check */}
      <div className={[
        "flex items-center gap-3 rounded-sm border px-4 py-3 text-sm",
        balanced
          ? "border-success/40 bg-success/10 text-success"
          : "border-danger/40 bg-danger/10 text-danger",
      ].join(" ")}>
        <span className="font-mono text-base font-bold">{balanced ? "✓" : "✗"}</span>
        <span>
          Assets ({fmt(totalAssets)}) = Liabilities + Equity ({fmt(totalLE)})
          {!balanced && ` — Difference: ${fmt(Math.abs(totalAssets - totalLE))}`}
        </span>
      </div>
    </div>
  );
}

// ─── P&L ───────────────────────────────────────────────────────────────────

function PnL({
  accounts,
  balanceMap,
}: {
  accounts: ChartOfAccount[];
  balanceMap: Map<string, { debits: number; credits: number }>;
}) {
  const revenues = accounts.filter((a) => a.type === "revenue");
  const expenses = accounts.filter((a) => a.type === "expense");

  const calcBalance = (a: ChartOfAccount) => {
    const { debits, credits } = balanceMap.get(a.id) ?? { debits: 0, credits: 0 };
    return NORMAL_SIDE[a.type] === "debit" ? debits - credits : credits - debits;
  };

  const totalRevenue = revenues.reduce((s, a) => s + calcBalance(a), 0);
  const totalExpenses = expenses.reduce((s, a) => s + calcBalance(a), 0);
  const netIncome = totalRevenue - totalExpenses;

  return (
    <div className="p-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
            <th className="px-4 py-2 w-24">Code</th>
            <th className="px-4 py-2">Account Name</th>
            <th className="px-4 py-2 w-40 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {/* Revenue */}
          <tr className="bg-surface-2 border-b border-line">
            <td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-2">
              Revenue
            </td>
            <td />
          </tr>
          {revenues.map((a) => {
            const bal = calcBalance(a);
            return (
              <tr key={a.id} className="border-b border-line hover:bg-surface-2">
                <td className="pl-8 pr-4 py-2 font-mono text-xs uppercase text-ink-2">{a.code}</td>
                <td className="px-4 py-2 text-ink">{a.name}</td>
                <td className="px-4 py-2 font-mono tabular-nums text-right text-ink">{fmt(bal)}</td>
              </tr>
            );
          })}
          {revenues.length === 0 && (
            <tr className="border-b border-line">
              <td colSpan={3} className="px-8 py-2 text-xs text-ink-3">No revenue accounts.</td>
            </tr>
          )}
          <tr className="border-b border-line border-t">
            <td colSpan={2} className="px-4 py-2 text-sm font-semibold text-ink">Total Revenue</td>
            <td className="px-4 py-2 font-mono tabular-nums text-right font-semibold text-ink">{fmt(totalRevenue)}</td>
          </tr>

          {/* Spacer */}
          <tr className="h-2" />

          {/* Expenses */}
          <tr className="bg-surface-2 border-b border-line">
            <td colSpan={2} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-ink-2">
              Expenses
            </td>
            <td />
          </tr>
          {expenses.map((a) => {
            const bal = calcBalance(a);
            return (
              <tr key={a.id} className="border-b border-line hover:bg-surface-2">
                <td className="pl-8 pr-4 py-2 font-mono text-xs uppercase text-ink-2">{a.code}</td>
                <td className="px-4 py-2 text-ink">{a.name}</td>
                <td className="px-4 py-2 font-mono tabular-nums text-right text-ink">{fmt(bal)}</td>
              </tr>
            );
          })}
          {expenses.length === 0 && (
            <tr className="border-b border-line">
              <td colSpan={3} className="px-8 py-2 text-xs text-ink-3">No expense accounts.</td>
            </tr>
          )}
          <tr className="border-b border-line border-t">
            <td colSpan={2} className="px-4 py-2 text-sm font-semibold text-ink">Total Expenses</td>
            <td className="px-4 py-2 font-mono tabular-nums text-right font-semibold text-ink">{fmt(totalExpenses)}</td>
          </tr>
        </tbody>
      </table>

      {/* Net Income */}
      <div className={[
        "mt-4 flex items-center justify-between rounded-sm border px-5 py-4",
        netIncome >= 0
          ? "border-success/40 bg-success/10"
          : "border-danger/40 bg-danger/10",
      ].join(" ")}>
        <span className="text-sm font-semibold text-ink">Net Income</span>
        <span className={[
          "font-mono text-xl font-bold tabular-nums",
          netIncome >= 0 ? "text-success" : "text-danger",
        ].join(" ")}>
          {netIncome < 0 ? "(" : ""}{fmt(Math.abs(netIncome))}{netIncome < 0 ? ")" : ""}
        </span>
      </div>
    </div>
  );
}

// ─── page ──────────────────────────────────────────────────────────────────

export default function FinancialReportsPage() {
  const [tab, setTab] = useState<Tab>("trial-balance");
  const [period, setPeriod] = useState<Period>("all");

  const { data: accounts = [], isLoading: loadingAccounts, error: accountsError } = useQuery({
    queryKey: ["accounting", "accounts"],
    queryFn: () => listAccounts(),
  });

  const { data: jeResult, isLoading: loadingJE, error: jeError } = useQuery({
    queryKey: ["accounting", "journal-entries", "posted"],
    queryFn: () => listJournalEntries({ status: "posted" }),
  });

  const filteredEntries = useMemo<JournalEntry[]>(() => {
    const all = jeResult?.items ?? [];
    return filterByPeriod(all, period);
  }, [jeResult, period]);

  const balanceMap = useMemo(
    () => groupLinesByAccount(filteredEntries),
    [filteredEntries],
  );

  const isLoading = loadingAccounts || loadingJE;
  const error = accountsError ?? jeError;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[
          { label: "Accounting Hub", href: "/accounting/home" },
          { label: "General Ledger" },
          { label: "Financial Reports" },
        ]}
      />

      <div className="flex items-center justify-between border-b border-line px-4 py-3 gap-4">
        <h1 className="text-base font-semibold text-ink">Financial Reports</h1>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-line bg-surface-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              "px-5 py-2.5 text-xs font-semibold transition-colors border-b-2 -mb-px",
              tab === t
                ? "border-accent text-accent bg-surface"
                : "border-transparent text-ink-3 hover:text-ink hover:bg-surface",
            ].join(" ")}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
        <div className="ml-auto flex items-center px-4">
          <span className="font-mono text-xs text-ink-3">
            {filteredEntries.length} posted entries
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {error && (
          <div className="m-4 rounded-sm border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error instanceof Error ? error.message : "Failed to load financial data"}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-px p-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <>
            {tab === "trial-balance" && (
              <TrialBalance accounts={accounts} balanceMap={balanceMap} />
            )}
            {tab === "balance-sheet" && (
              <BalanceSheet accounts={accounts} balanceMap={balanceMap} />
            )}
            {tab === "pnl" && (
              <PnL accounts={accounts} balanceMap={balanceMap} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
