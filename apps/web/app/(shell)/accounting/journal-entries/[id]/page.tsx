"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { getJournalEntry, postJournalEntry, type JournalEntry, type JEStatus } from "@/lib/api/accounting";

const STATUS_COLORS: Record<JEStatus, string> = {
  draft: "bg-surface-2 text-ink-3",
  posted: "bg-green-100 text-green-700",
  void: "bg-red-100 text-red-600",
};

export default function JournalEntryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [je, setJe] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!id) return;
    getJournalEntry(id).then(setJe).finally(() => setLoading(false));
  }, [id]);

  async function handlePost() {
    if (!je) return;
    setPosting(true);
    const updated = await postJournalEntry(je.id).catch(() => null);
    if (updated) setJe(updated);
    setPosting(false);
  }

  const fmt = (n: number) => n.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const totalDebit = je?.lines.reduce((s, l) => s + l.debit, 0) ?? 0;
  const totalCredit = je?.lines.reduce((s, l) => s + l.credit, 0) ?? 0;
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading…</div>;
  if (!je) return <div className="p-6 text-sm text-red-600">Journal entry not found</div>;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Accounting" }, { label: "Journal Entries", href: "/accounting/journal-entries" }, { label: je.refNo }]} />

      {/* Header */}
      <div className="rounded-lg border border-line bg-surface p-5 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-xl font-semibold font-mono">{je.refNo}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[je.status]}`}>{je.status}</span>
            {!isBalanced && je.lines.length > 0 && (
              <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">Unbalanced</span>
            )}
          </div>
          <div className="text-sm text-ink-3 space-y-0.5">
            <div>Date: {je.entryDate?.slice(0, 10)}</div>
            {je.memo && <div>{je.memo}</div>}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          {je.status === "draft" && (
            <button onClick={handlePost} disabled={posting || !isBalanced} className="px-3 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-50">
              Post Entry
            </button>
          )}
          <button onClick={() => router.back()} className="px-3 py-1.5 text-xs rounded border border-line text-ink-3 hover:text-ink">← Back</button>
        </div>
      </div>

      {/* Balance summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Total Debit</div>
          <div className="text-xl font-mono font-bold">{fmt(totalDebit)}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Total Credit</div>
          <div className="text-xl font-mono font-bold">{fmt(totalCredit)}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Balance</div>
          <div className={`text-xl font-mono font-bold ${isBalanced ? "text-green-600" : "text-red-600"}`}>
            {isBalanced ? "Balanced ✓" : fmt(Math.abs(totalDebit - totalCredit))}
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="rounded-lg border border-line overflow-hidden">
        <div className="px-4 py-3 bg-surface-2 text-sm font-medium">Journal Lines ({je.lines.length})</div>
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-3 uppercase bg-surface-2">
            <tr>
              <th className="px-4 py-2 text-left font-medium">#</th>
              <th className="px-4 py-2 text-left font-medium">Account</th>
              <th className="px-4 py-2 text-left font-medium">Memo</th>
              <th className="px-4 py-2 text-right font-medium">Debit</th>
              <th className="px-4 py-2 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {je.lines.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-ink-3">No lines</td></tr>}
            {je.lines.map(l => (
              <tr key={l.id} className="border-t border-line hover:bg-surface-2">
                <td className="px-4 py-3 text-xs text-ink-3">{l.lineNo}</td>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs">{l.accountCode}</div>
                  <div className="text-xs text-ink-3">{l.accountName}</div>
                </td>
                <td className="px-4 py-3 text-xs text-ink-3">{l.memo}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{l.debit > 0 ? fmt(l.debit) : ""}</td>
                <td className="px-4 py-3 text-right font-mono text-xs">{l.credit > 0 ? fmt(l.credit) : ""}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-line bg-surface-2 font-semibold">
              <td colSpan={3} className="px-4 py-2 text-right text-xs">Totals</td>
              <td className="px-4 py-2 text-right font-mono text-xs">{fmt(totalDebit)}</td>
              <td className="px-4 py-2 text-right font-mono text-xs">{fmt(totalCredit)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
