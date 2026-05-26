"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Input, Tag } from "@pmplatform/ui-kit";
import { listLots, type Lot, type LotStatus } from "@/lib/api/mfg";

const STATUS_TONES: Record<LotStatus, "warning" | "success" | "neutral" | "signal"> = {
  released:   "success",
  hold:       "warning",
  quarantine: "warning",
  consumed:   "neutral",
};

// "scrapped" may arrive from the backend even though LotStatus doesn't include it
// mapping unknown values gracefully via a fallback below

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "",            label: "All"        },
  { value: "released",   label: "Released"   },
  { value: "hold",       label: "Hold"       },
  { value: "quarantine", label: "Quarantine" },
  { value: "consumed",   label: "Consumed"   },
];

function statusTone(s: string): "warning" | "success" | "neutral" | "signal" {
  return STATUS_TONES[s as LotStatus] ?? "neutral";
}

export default function LotsPage() {
  const router = useRouter();
  const [lots, setLots] = useState<Lot[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listLots({ status: statusFilter || undefined, limit: 100 });
      // client-side lot number filter since backend may not support q param
      const filtered = q
        ? res.items.filter(l => l.lotNo.toLowerCase().includes(q.toLowerCase()))
        : res.items;
      setLots(filtered);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load lots");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, q]);

  useEffect(() => { void load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // debounce q separately so typing doesn't fire network on each keystroke
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Lots" }]} />
      <CommandBar actions={[
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      {/* Filters */}
      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-2">
        <div className="flex gap-1">
          {STATUS_TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setStatusFilter(t.value)}
              className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === t.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="h-4 w-px bg-line" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search lot number…"
          className="max-w-64 h-8 text-xs"
        />
        <span className="ml-auto text-xs text-ink-3">{total} lots</span>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        )}
        {loading && !lots.length ? (
          <div className="space-y-px">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Lot Number</th>
                <th className="px-4 py-2">Item ID</th>
                <th className="px-4 py-2 text-right">Qty on Hand</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created At</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => (
                <tr
                  key={lot.id}
                  onClick={() => router.push(`/mfg/lots/${lot.id}`)}
                  className="cursor-pointer border-b border-line hover:bg-surface-2"
                >
                  <td className="px-4 py-2 font-mono text-xs uppercase text-ink">{lot.lotNo}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-2">{lot.itemId}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-ink">{lot.qtyOnHand}</td>
                  <td className="px-4 py-2">
                    <Tag tone={statusTone(lot.status)} dot>{lot.status}</Tag>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-3">
                    {lot.createdAt ? new Date(lot.createdAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
              {!loading && lots.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-3">
                    No lots found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
