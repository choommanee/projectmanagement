"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import {
  listInspections, listNCRs, listApqp,
  type Inspection, type NCR, type ApqpProject, type NcrStatus,
} from "@/lib/api/quality";

export default function QualityDashboardPage() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [ncrs, setNcrs] = useState<NCR[]>([]);
  const [apqps, setApqps] = useState<ApqpProject[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listInspections({ limit: 100 }).then(setInspections),
      listNCRs({ limit: 100 }).then(setNcrs),
      listApqp().then(setApqps),
    ]).finally(() => setLoading(false));
  }, []);

  const passCount = useMemo(() => inspections.filter(i => i.result === "pass").length, [inspections]);
  const failCount = useMemo(() => inspections.filter(i => i.result === "fail").length, [inspections]);
  const holdCount = useMemo(() => inspections.filter(i => i.result === "hold").length, [inspections]);
  const passRate = inspections.length === 0 ? null : Math.round(passCount / inspections.length * 100);

  const openNcrs = useMemo(() => ncrs.filter(n => n.status === "open").length, [ncrs]);
  const investigatingNcrs = useMemo(() => ncrs.filter(n => n.status === "investigating").length, [ncrs]);
  const highSeverityNcrs = useMemo(() => ncrs.filter(n => n.severity >= 3).length, [ncrs]);

  const ncrByStatus = useMemo(() => {
    const m: Record<NcrStatus, number> = { open: 0, investigating: 0, corrected: 0, closed: 0 };
    for (const n of ncrs) m[n.status] = (m[n.status] ?? 0) + 1;
    return m;
  }, [ncrs]);

  const recentNcrs = useMemo(() =>
    [...ncrs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    [ncrs]
  );

  const NCR_STATUS_COLORS: Record<NcrStatus, string> = {
    open: "bg-red-100 text-red-700",
    investigating: "bg-amber-100 text-amber-700",
    corrected: "bg-blue-100 text-blue-700",
    closed: "bg-green-100 text-green-700",
  };

  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  if (loading) return <div className="p-6 text-sm text-ink-3">Loading...</div>;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Quality Hub", href: "/quality/home" }, { label: "Dashboard" }]} />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="flex items-baseline justify-between">
          <h1 className="text-base font-semibold text-ink">Quality Dashboard</h1>
          <span className="font-mono text-xs text-ink-3">{today}</span>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-4 gap-4">
          <div className="border border-line bg-surface p-4">
            <div className="text-xs font-medium uppercase tracking-widest text-ink-3 mb-1">Pass Rate</div>
            <div className={`font-mono text-3xl font-semibold tabular-nums ${passRate != null && passRate < 90 ? "text-red-600" : "text-green-600"}`}>
              {passRate != null ? `${passRate}%` : "—"}
            </div>
            <div className="text-xs text-ink-3 mt-1">{inspections.length} inspections</div>
          </div>
          <div className="border border-line bg-surface p-4">
            <div className="text-xs font-medium uppercase tracking-widest text-ink-3 mb-1">Open NCRs</div>
            <div className={`font-mono text-3xl font-semibold tabular-nums ${openNcrs > 0 ? "text-red-600" : "text-green-600"}`}>
              {openNcrs}
            </div>
            <div className="text-xs text-ink-3 mt-1">{investigatingNcrs} under investigation</div>
          </div>
          <div className="border border-line bg-surface p-4">
            <div className="text-xs font-medium uppercase tracking-widest text-ink-3 mb-1">High Severity NCRs</div>
            <div className={`font-mono text-3xl font-semibold tabular-nums ${highSeverityNcrs > 0 ? "text-amber-600" : "text-green-600"}`}>
              {highSeverityNcrs}
            </div>
            <div className="text-xs text-ink-3 mt-1">severity &ge; 3</div>
          </div>
          <div className="border border-line bg-surface p-4">
            <div className="text-xs font-medium uppercase tracking-widest text-ink-3 mb-1">Active APQP</div>
            <div className="font-mono text-3xl font-semibold tabular-nums text-ink">
              {apqps.filter(a => a.status === "in_progress").length}
            </div>
            <div className="text-xs text-ink-3 mt-1">{apqps.length} total projects</div>
          </div>
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-2 gap-6">
          {/* Inspection results bar chart */}
          <div className="border border-line bg-surface p-4">
            <h3 className="text-xs font-medium uppercase tracking-widest text-ink-3 mb-3">Inspection Results</h3>
            <div className="space-y-2">
              {(
                [
                  ["pass", passCount, "bg-green-500"],
                  ["fail", failCount, "bg-red-500"],
                  ["hold", holdCount, "bg-amber-500"],
                ] as const
              ).map(([label, count, color]) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-xs text-ink-3 w-10 capitalize">{label}</span>
                  <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${color}`}
                      style={{ width: inspections.length === 0 ? "0%" : `${(count / inspections.length) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono w-8 text-right text-ink">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* NCR by status */}
          <div className="border border-line bg-surface p-4">
            <h3 className="text-xs font-medium uppercase tracking-widest text-ink-3 mb-3">NCR by Status</h3>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(ncrByStatus) as [NcrStatus, number][]).map(([status, count]) => (
                <div key={status} className={`rounded px-3 py-2 ${NCR_STATUS_COLORS[status]}`}>
                  <div className="text-lg font-mono font-bold">{count}</div>
                  <div className="text-xs capitalize">{status.replace("_", " ")}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent NCRs table */}
        <div className="border border-line overflow-hidden">
          <div className="px-4 py-3 bg-muted/50 text-xs font-medium uppercase tracking-widest text-ink-3">Recent NCRs</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-line bg-muted/30">
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Description</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Severity</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Qty</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Status</th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-widest text-ink-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {recentNcrs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-xs text-ink-3">
                    No NCRs found
                  </td>
                </tr>
              )}
              {recentNcrs.map(ncr => (
                <tr key={ncr.id} className="border-t border-line hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs text-ink">{ncr.description || "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs font-mono ${
                        ncr.severity >= 3 ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-600"
                      }`}
                    >
                      {ncr.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-ink">{ncr.qty}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${NCR_STATUS_COLORS[ncr.status]}`}>
                      {ncr.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-3">
                    {new Date(ncr.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
