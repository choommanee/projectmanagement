"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { listRoutings, type RoutingHeader, type BOMStatus } from "@/lib/api/mfg";

const STATUS_TONES: Record<BOMStatus, "neutral" | "success" | "warning"> = {
  draft:    "neutral",
  active:   "success",
  obsolete: "warning",
};

const STATUS_TABS: { value: string; label: string }[] = [
  { value: "",         label: "All"      },
  { value: "draft",    label: "Draft"    },
  { value: "active",   label: "Active"   },
  { value: "obsolete", label: "Obsolete" },
];

export default function RoutingsPage() {
  const router = useRouter();
  const [routings, setRoutings] = useState<RoutingHeader[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listRoutings({ status: statusFilter || undefined, limit: 100 });
      setRoutings(res.items);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load routings");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Routings" }]} />
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
        <span className="ml-auto text-xs text-ink-3">{total} routings</span>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
        )}
        {loading && !routings.length ? (
          <div className="space-y-px">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-10 animate-pulse border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                <th className="px-4 py-2">Routing ID</th>
                <th className="px-4 py-2">Item ID</th>
                <th className="px-4 py-2 text-center">Version</th>
                <th className="px-4 py-2 text-center">Default</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2 text-right">Ops</th>
                <th className="px-4 py-2">Created At</th>
              </tr>
            </thead>
            <tbody>
              {routings.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => router.push(`/mfg/routings/${r.id}`)}
                  className="cursor-pointer border-b border-line hover:bg-surface-2"
                >
                  <td className="px-4 py-2 font-mono text-xs text-ink">{r.id}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-2">{r.itemId}</td>
                  <td className="px-4 py-2 text-center font-mono text-xs text-ink">{r.version}</td>
                  <td className="px-4 py-2 text-center">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${r.isDefault ? "bg-success" : "border border-line bg-surface-2"}`}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Tag tone={STATUS_TONES[r.status]} dot>{r.status}</Tag>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-ink">
                    {r.operations?.length ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-3">
                    {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
              {!loading && routings.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-ink-3">
                    No routings found.
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
