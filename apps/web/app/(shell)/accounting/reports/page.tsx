"use client";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";
import { listAccounts, type AccountType, type ChartOfAccount } from "@/lib/api/accounting";

const ACCOUNT_TYPE_ORDER: AccountType[] = ["asset", "liability", "equity", "revenue", "expense"];

const TYPE_LABELS: Record<AccountType, string> = {
  asset:     "Assets",
  liability: "Liabilities",
  equity:    "Equity",
  revenue:   "Revenue",
  expense:   "Expenses",
};

const NORMAL_BALANCE: Record<AccountType, string> = {
  asset:     "Debit",
  liability: "Credit",
  equity:    "Credit",
  revenue:   "Credit",
  expense:   "Debit",
};

function typeTone(t: AccountType): "neutral" | "info" | "accent" | "success" | "warning" | "danger" {
  if (t === "asset")     return "success";
  if (t === "liability") return "danger";
  if (t === "equity")    return "info";
  if (t === "revenue")   return "accent";
  if (t === "expense")   return "warning";
  return "neutral";
}

function AccountSection({ type, accounts }: { type: AccountType; accounts: ChartOfAccount[] }) {
  const filtered = accounts.filter(a => a.type === type);
  return (
    <section className="mb-6">
      <div className="flex items-center gap-3 border-b border-line bg-surface-2 px-4 py-2">
        <Tag tone={typeTone(type)}>{type}</Tag>
        <span className="text-sm font-semibold text-ink">{TYPE_LABELS[type]}</span>
        <span className="ml-auto font-mono text-xs text-ink-3">{filtered.length} accounts</span>
      </div>
      {filtered.length === 0 ? (
        <div className="px-4 py-4 text-xs text-ink-3">No {type} accounts defined.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs font-medium text-ink-3">
              <th className="px-4 py-2">Code</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Currency</th>
              <th className="px-4 py-2">Normal Balance</th>
              <th className="px-4 py-2 text-center">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="border-b border-line hover:bg-surface-2">
                <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{a.code}</td>
                <td className="px-4 py-2 font-medium text-ink">{a.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-2">{a.currency}</td>
                <td className="px-4 py-2 text-xs text-ink-2">{NORMAL_BALANCE[type]}</td>
                <td className="px-4 py-2 text-center">
                  <Tag tone={a.active ? "success" : "neutral"} dot>
                    {a.active ? "active" : "inactive"}
                  </Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default function FinancialReportsPage() {
  const { data: accounts = [], isLoading, error } = useQuery({
    queryKey: ["accounting", "accounts"],
    queryFn: () => listAccounts(),
  });

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Accounting Hub", href: "/accounting/home" }, { label: "General Ledger" }, { label: "Financial Reports" }]} />

      <div className="flex-1 overflow-auto">
        <div className="flex items-baseline justify-between border-b border-line px-4 py-3">
          <h1 className="text-base font-semibold text-ink">Financial Reports</h1>
          <span className="font-mono text-xs text-ink-3">Chart of Accounts — {accounts.length} total</span>
        </div>

        {error && (
          <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">
            {error instanceof Error ? error.message : "Failed to load accounts"}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-px p-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <div className="p-4">
            {ACCOUNT_TYPE_ORDER.map(type => (
              <AccountSection key={type} type={type} accounts={accounts} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
