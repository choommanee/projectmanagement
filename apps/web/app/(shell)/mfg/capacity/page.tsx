"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listWorkCenters, listWorkOrders, type WorkCenter, type WorkOrder } from "@/lib/api/mfg";

// ── date helpers ────────────────────────────────────────────────────────────

function weekMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0=Sun, 1=Mon, ...
  const diff = (day === 0 ? -6 : 1 - day); // days to subtract to reach Monday
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function weekKey(d: Date): string {
  // ISO week: YYYY-Www
  const monday = weekMonday(d);
  const year = monday.getFullYear();
  const jan4 = new Date(year, 0, 4);
  const weekNo = Math.ceil(((monday.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7);
  return `${year}-W${String(weekNo).padStart(2, "0")}`;
}

function formatWeekLabel(monday: Date): string {
  const end = addDays(monday, 4); // Friday
  const mStr = monday.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const eStr = end.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  return `${mStr} – ${eStr}`;
}

// ── component ──────────────────────────────────────────────────────────────

export default function CapacityPlanningPage() {
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      listWorkCenters(),
      listWorkOrders({ limit: 500 }).then((r) => r.items),
    ])
      .then(([wcs, wos]) => {
        setWorkCenters(wcs);
        setWorkOrders(wos);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  // 4 weeks starting from this Monday
  const weeks = useMemo(() => {
    const monday = weekMonday(new Date());
    return Array.from({ length: 4 }, (_, i) => {
      const start = addDays(monday, i * 7);
      const end = addDays(start, 6); // Sunday
      return { key: weekKey(start), start, end, label: formatWeekLabel(start) };
    });
  }, []);

  // grid: Map<wcId, Map<weekKey, loadHrs>>
  const grid = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const wc of workCenters) {
      const inner = new Map<string, number>();
      for (const w of weeks) inner.set(w.key, 0);
      map.set(wc.id, inner);
    }
    for (const wo of workOrders) {
      if (!wo.workCenterId) continue;
      const startDate = wo.startAt ? new Date(wo.startAt) : null;
      if (!startDate || isNaN(startDate.getTime())) continue;
      const key = weekKey(startDate);
      const inner = map.get(wo.workCenterId);
      if (!inner || !inner.has(key)) continue;
      // load = qty hours (1 hr per qty unit as a reasonable default when no run time is embedded on WO)
      const loadHrs = wo.qty;
      inner.set(key, (inner.get(key) ?? 0) + loadHrs);
    }
    return map;
  }, [workCenters, workOrders, weeks]);

  // summary for current week
  const thisWeekKey = weeks[0]?.key ?? "";
  const overloadedCount = useMemo(() => {
    let count = 0;
    for (const wc of workCenters) {
      const cap = wc.capacityPerDayHrs * 5;
      const load = grid.get(wc.id)?.get(thisWeekKey) ?? 0;
      if (load > cap) count++;
    }
    return count;
  }, [workCenters, grid, thisWeekKey]);

  function cellClass(load: number, capacity: number): string {
    if (capacity === 0) return "bg-zinc-800 text-zinc-400";
    const pct = load / capacity;
    if (pct > 1) return "bg-red-950 text-red-300 border-red-700";
    if (pct > 0.8) return "bg-amber-950 text-amber-300 border-amber-700";
    if (load === 0) return "bg-zinc-900 text-zinc-500";
    return "bg-emerald-950 text-emerald-300 border-emerald-800";
  }

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "MFG" }, { label: "Capacity Planning" }]} />

      {/* summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="border border-zinc-700 rounded bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Work Centers</p>
          <p className="text-2xl font-mono font-bold text-zinc-100">{workCenters.length}</p>
        </div>
        <div className="border border-zinc-700 rounded bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Overloaded (Wk 1)</p>
          <p className={`text-2xl font-mono font-bold ${overloadedCount > 0 ? "text-red-400" : "text-emerald-400"}`}>
            {overloadedCount}
          </p>
        </div>
        <div className="border border-zinc-700 rounded bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Active Work Orders</p>
          <p className="text-2xl font-mono font-bold text-zinc-100">{workOrders.length}</p>
        </div>
        <div className="border border-zinc-700 rounded bg-zinc-900 p-4">
          <p className="text-xs text-zinc-500 uppercase tracking-widest mb-1">Planning Horizon</p>
          <p className="text-2xl font-mono font-bold text-zinc-100">4 wks</p>
        </div>
      </div>

      {/* legend */}
      <div className="flex items-center gap-4 text-xs text-zinc-400">
        <span className="font-semibold text-zinc-300">Legend:</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-emerald-950 border border-emerald-800" />
          Normal (&le;80%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-amber-950 border border-amber-700" />
          High (80–100%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-red-950 border border-red-700" />
          Overloaded (&gt;100%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm bg-zinc-900 border border-zinc-700" />
          No load
        </span>
      </div>

      {error && (
        <div className="border border-red-700 bg-red-950 text-red-300 rounded px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-zinc-400 text-sm py-12 text-center">Loading capacity data...</div>
      ) : workCenters.length === 0 ? (
        <div className="text-zinc-500 text-sm py-12 text-center">No work centers found.</div>
      ) : (
        /* capacity grid */
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse border border-zinc-700">
            <thead>
              <tr className="bg-zinc-800 text-zinc-300 uppercase text-xs tracking-wider">
                <th className="border border-zinc-700 px-4 py-2 text-left w-52">Work Center</th>
                <th className="border border-zinc-700 px-4 py-2 text-center w-24">Type</th>
                <th className="border border-zinc-700 px-4 py-2 text-center w-24">Cap/Wk (h)</th>
                {weeks.map((w) => (
                  <th key={w.key} className="border border-zinc-700 px-4 py-2 text-center min-w-[130px]">
                    <div className="font-mono text-zinc-100">{w.key}</div>
                    <div className="text-zinc-400 font-normal normal-case text-xs">{w.label}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {workCenters.map((wc) => {
                const capPerWeek = wc.capacityPerDayHrs * 5;
                return (
                  <tr key={wc.id} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="border border-zinc-700 px-4 py-2">
                      <div className="font-medium text-zinc-100">{wc.name}</div>
                      <div className="text-xs text-zinc-500 font-mono">{wc.code}</div>
                    </td>
                    <td className="border border-zinc-700 px-4 py-2 text-center">
                      <span className="text-xs px-1.5 py-0.5 rounded border border-zinc-600 text-zinc-400 uppercase font-mono">
                        {wc.type}
                      </span>
                    </td>
                    <td className="border border-zinc-700 px-4 py-2 text-center font-mono text-zinc-300">
                      {capPerWeek.toFixed(0)}
                    </td>
                    {weeks.map((w) => {
                      const load = grid.get(wc.id)?.get(w.key) ?? 0;
                      const pct = capPerWeek > 0 ? Math.round((load / capPerWeek) * 100) : 0;
                      return (
                        <td
                          key={w.key}
                          className={`border border-zinc-700 px-3 py-2 text-center ${cellClass(load, capPerWeek)}`}
                        >
                          <div className="font-mono font-semibold text-sm">
                            {load.toFixed(0)}<span className="text-xs opacity-60"> / {capPerWeek.toFixed(0)}</span>
                          </div>
                          <div className="text-xs opacity-70">{pct}%</div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
