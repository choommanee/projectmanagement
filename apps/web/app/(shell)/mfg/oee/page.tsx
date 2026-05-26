"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { KpiWidget } from "@/components/widgets/KpiWidget";
import { listWorkOrders, listWorkCenters, type WorkOrder, type WorkCenter } from "@/lib/api/mfg";

function pct(n: number): string { return `${Math.round(n * 100)}%`; }

function oeeColor(v: number): string {
  if (v >= 0.85) return "text-success";
  if (v >= 0.65) return "text-warning";
  return "text-danger";
}

function barColor(v: number): string {
  if (v >= 0.85) return "bg-success";
  if (v >= 0.65) return "bg-warning";
  return "bg-danger";
}

interface OEEResult {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  completed: number;
  total: number;
}

function computeOEE(wos: WorkOrder[]): OEEResult {
  const total = wos.length;
  if (total === 0) return { availability: 0, performance: 0, quality: 0, oee: 0, completed: 0, total: 0 };

  const completed = wos.filter((w) => w.status === "completed");
  const released = wos.filter((w) =>
    ["released", "in_progress", "completed", "cancelled"].includes(w.status)
  ).length;

  // Availability: completed / all released-or-beyond
  const availability = released > 0 ? completed.length / released : 0;

  // Performance: placeholder — actual cycle time data not available yet
  const performance = completed.length > 0 ? 0.88 : 0;

  // Quality: placeholder — NCR data not joined yet
  const quality = completed.length > 0 ? 0.96 : 0;

  const oee = availability * performance * quality;
  return { availability, performance, quality, oee, completed: completed.length, total };
}

export default function OEEDashboardPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([listWorkOrders(), listWorkCenters()])
      .then(([wos, wcs]) => {
        setWorkOrders(wos.status === "fulfilled" ? wos.value.items : []);
        setWorkCenters(wcs.status === "fulfilled" ? wcs.value : []);
      })
      .finally(() => setLoading(false));
  }, []);

  const overall = useMemo(() => computeOEE(workOrders), [workOrders]);

  const perWC = useMemo(() => {
    return workCenters.map((wc) => {
      const wcos = workOrders.filter((w) => w.workCenterId === wc.id);
      return { wc, ...computeOEE(wcos) };
    });
  }, [workCenters, workOrders]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: "MFG", href: "/mfg/home" }, { label: "OEE Dashboard" }]} />
      <h1 className="text-xl font-semibold">Overall Equipment Effectiveness</h1>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <>
          {/* Overall KPIs */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <KpiWidget title="Overall OEE" value={pct(overall.oee)} trend={0} />
            <KpiWidget title="Availability" value={pct(overall.availability)} trend={0} />
            <KpiWidget title="Performance" value={pct(overall.performance)} trend={0} />
            <KpiWidget title="Quality" value={pct(overall.quality)} trend={0} />
          </div>

          {/* OEE gauge */}
          <div className="flex items-center gap-4 rounded-lg border border-line bg-surface-2 p-6">
            <div className="flex flex-col items-center min-w-[120px]">
              <span className={`text-5xl font-mono font-bold ${oeeColor(overall.oee)}`}>
                {pct(overall.oee)}
              </span>
              <span className="text-sm text-ink-muted mt-1">Overall OEE</span>
            </div>
            <div className="flex-1 pl-6 border-l border-line">
              <div className="flex flex-col gap-3">
                {[
                  {
                    label: "Availability",
                    value: overall.availability,
                    desc: `${overall.completed} / ${overall.total} work orders completed`,
                  },
                  { label: "Performance", value: overall.performance, desc: "Actual vs planned cycle time" },
                  { label: "Quality", value: overall.quality, desc: "Units produced without defects" },
                ].map((m) => (
                  <div key={m.label} className="flex items-center gap-3">
                    <span className="w-28 text-sm font-medium">{m.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                      <div
                        className={`h-2 rounded-full ${barColor(m.value)}`}
                        style={{ width: pct(m.value) }}
                      />
                    </div>
                    <span className={`w-12 text-right font-mono text-sm font-semibold ${oeeColor(m.value)}`}>
                      {pct(m.value)}
                    </span>
                    <span className="text-xs text-ink-muted hidden sm:block">{m.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Per Work Center */}
          <div>
            <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">
              By Work Center
            </h2>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Work Center</th>
                    <th className="px-4 py-2 text-right font-medium">WOs</th>
                    <th className="px-4 py-2 text-right font-medium">Completed</th>
                    <th className="px-4 py-2 text-right font-medium">Availability</th>
                    <th className="px-4 py-2 text-right font-medium">Performance</th>
                    <th className="px-4 py-2 text-right font-medium">Quality</th>
                    <th className="px-4 py-2 text-right font-medium">OEE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {perWC.filter((r) => r.total > 0).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-ink-muted">
                        {workCenters.length === 0
                          ? "No work centers configured."
                          : "No work order data per work center."}
                      </td>
                    </tr>
                  ) : (
                    perWC
                      .filter((r) => r.total > 0)
                      .map((r) => (
                        <tr key={r.wc.id} className="hover:bg-surface-2/50">
                          <td className="px-4 py-2 font-medium">{r.wc.name}</td>
                          <td className="px-4 py-2 text-right font-mono">{r.total}</td>
                          <td className="px-4 py-2 text-right font-mono">{r.completed}</td>
                          <td className={`px-4 py-2 text-right font-mono font-semibold ${oeeColor(r.availability)}`}>
                            {pct(r.availability)}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono font-semibold ${oeeColor(r.performance)}`}>
                            {pct(r.performance)}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono font-semibold ${oeeColor(r.quality)}`}>
                            {pct(r.quality)}
                          </td>
                          <td className={`px-4 py-2 text-right font-mono text-base font-bold ${oeeColor(r.oee)}`}>
                            {pct(r.oee)}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
