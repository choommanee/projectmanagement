"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAccount, listJournalEntries, type ChartOfAccount, type JournalEntry, type AccountType } from "@/lib/api/accounting";

export default function AccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [account, setAccount] = useState<ChartOfAccount | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      getAccount(id),
      listJournalEntries(),
    ]).then(([acc, jeResult]) => {
      setAccount(acc);
      // filter JEs that touch this account
      const filtered = jeResult.items.filter(je =>
        je.lines.some(l => l.accountId === id)
      );
      setEntries(filtered.slice(0, 20));
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading...</div>;
  if (!account) return <div className="p-8 text-destructive">Account not found.</div>;

  const typeColors: Record<AccountType, string> = {
    asset: "bg-blue-100 text-blue-800",
    liability: "bg-red-100 text-red-800",
    equity: "bg-purple-100 text-purple-800",
    revenue: "bg-green-100 text-green-800",
    expense: "bg-orange-100 text-orange-800",
  };

  return (
    <div className="p-6 space-y-6">
      <nav className="text-sm text-muted-foreground">
        <button onClick={() => router.push("/accounting/accounts")} className="hover:underline">Chart of Accounts</button>
        <span className="mx-2">/</span>
        <span>{account.code} {account.name}</span>
      </nav>

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">{account.code} — {account.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">Currency: {account.currency} · {account.active ? "Active" : "Inactive"}</p>
          </div>
          <span className={`px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${typeColors[account.type]}`}>
            {account.type}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {[
          { label: "Account Code", value: account.code },
          { label: "Account Type", value: account.type },
          { label: "Currency", value: account.currency },
          { label: "Active", value: account.active ? "Yes" : "No" },
          { label: "Recent JEs", value: String(entries.length) },
          { label: "Created", value: account.createdAt ? account.createdAt.slice(0, 10) : "—" },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className="mt-1 text-sm font-semibold">{value}</p>
          </div>
        ))}
      </div>

      {entries.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Recent Journal Entries
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground text-xs uppercase">
                <th className="py-2 pr-4">Reference</th>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Memo</th>
                <th className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(je => (
                <tr key={je.id} className="border-t border-border hover:bg-muted/30 cursor-pointer"
                  onClick={() => router.push('/accounting/journal-entries/' + je.id)}>
                  <td className="py-2 pr-4 font-mono text-xs">{je.refNo || je.id.slice(0, 8)}</td>
                  <td className="py-2 pr-4">{je.entryDate ? je.entryDate.slice(0, 10) : je.createdAt?.slice(0, 10) ?? "—"}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{je.memo || "—"}</td>
                  <td className="py-2">
                    <span className={`px-2 py-0.5 rounded text-xs ${je.status === 'posted' ? 'bg-green-100 text-green-800' : 'bg-muted text-muted-foreground'}`}>
                      {je.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
