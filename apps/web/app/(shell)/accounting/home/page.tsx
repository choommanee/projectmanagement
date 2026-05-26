"use client";
import { useQuery } from "@tanstack/react-query";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listAccounts, listJournalEntries, listInvoices } from "@/lib/api/accounting";

interface KpiTileProps {
  label: string;
  value: number | string;
  sub?: string;
}

function KpiTile({ label, value, sub }: KpiTileProps) {
  return (
    <div className="border border-line bg-surface p-4">
      <div className="text-xs font-medium uppercase tracking-widest text-ink-3">{label}</div>
      <div className="mt-2 font-mono text-3xl font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export default function AccountingHomePage() {
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounting", "accounts"],
    queryFn: () => listAccounts(),
  });

  const { data: jeDraft } = useQuery({
    queryKey: ["accounting", "je", "draft"],
    queryFn: () => listJournalEntries({ status: "draft" }),
  });

  const { data: jePosted } = useQuery({
    queryKey: ["accounting", "je", "posted"],
    queryFn: () => listJournalEntries({ status: "posted" }),
  });

  const { data: invUnpaid } = useQuery({
    queryKey: ["accounting", "invoices", "unpaid"],
    queryFn: () => listInvoices({ status: "issued" }),
  });

  const { data: invOverdue } = useQuery({
    queryKey: ["accounting", "invoices", "overdue"],
    queryFn: () => listInvoices({ status: "overdue" }),
  });

  const unpaidCount = (invUnpaid?.total ?? 0) + (invOverdue?.total ?? 0);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Accounting Hub", href: "/accounting/home" }, { label: "Dashboard" }]} />

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-base font-semibold text-ink">Accounting Dashboard</h1>
          <span className="font-mono text-xs text-ink-3">{today}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <KpiTile
            label="Total Accounts"
            value={accounts.length}
            sub="Chart of accounts entries"
          />
          <KpiTile
            label="Journal Entries — Draft"
            value={jeDraft?.total ?? 0}
            sub="Pending review / posting"
          />
          <KpiTile
            label="Journal Entries — Posted"
            value={jePosted?.total ?? 0}
            sub="Finalized ledger entries"
          />
          <KpiTile
            label="Invoices Unpaid"
            value={unpaidCount}
            sub="Issued + overdue invoices"
          />
        </div>
      </div>
    </div>
  );
}
