"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listWorkOrders, listWorkCenters, type WorkOrder, type WorkCenter, type WOStatus } from "@/lib/api/mfg";

function weekMonday(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  m.setHours(0, 0, 0, 0);
  return m;
}

function addWeeks(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n * 7);
  return r;
}

function weekKey(d: Date): string {
  return weekMonday(d).toISOString().slice(0, 10);
}

function getWOWeek(wo: WorkOrder): string | null {
  const d = wo.startAt ?? wo.dueDate;
  if (!d) return null;
  return weekKey(new Date(d));
}

const STATUS_COLORS: Record<WOStatus, string> = {
  planned:     "bg-surface-2 text-ink-2",
  released:    "bg-accent/10 text-accent",
  in_progress: "bg-warning/10 text-warning",
  completed:   "bg-success/10 text-success",
  closed:      "bg-surface-2 text-ink-3",
  cancelled:   "bg-danger/10 text-danger",
};

export default function ProductionCalendarPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);

  const weeks = useMemo(() => {
    const m = addWeeks(weekMonday(new Date()), weekOffset);
    return Array.from({ length: 4 }, (_, i) => addWeeks(m, i));
  }, [weekOffset]);

  useEffect(() => {
    Promise.all([
      listWorkOrders({ limit: 500 }).then(r => setWorkOrders(r.items)),
      listWorkCenters().then(setWorkCenters),
    ]).finally(() => setLoading(false));
  }, []);

  const grid = useMemo(() => {
    const g = new Map<string, Map<string, WorkOrder[]>>();
    const weekKeys = new Set(weeks.map(w => weekKey(w)));
    for (const wc of workCenters) g.set(wc.id, new Map());
    g.set("__unassigned__", new Map());
    for (const wo of workOrders) {
      const wk = getWOWeek(wo);
      if (!wk || !weekKeys.has(wk)) continue;
      const wcId = wo.workCenterId ?? "__unassigned__";
      if (!g.has(wcId)) g.set(wcId, new Map());
      const wcMap = g.get(wcId)!;
      if (!wcMap.has(wk)) wcMap.set(wk, []);
      wcMap.get(wk)!.push(wo);
    }
    return g;
  }, [workOrders, workCenters, weeks]);

  const visibleRows = useMemo(() => {
    const rows: { id: string; name: string }[] = [
      ...workCenters.map(wc => ({ id: wc.id, name: wc.name })),
      { id: "__unassigned__", name: "Unassigned" },
    ];
    return rows.filter(r => {
      const wcMap = grid.get(r.id);
      return wcMap && wcMap.size > 0;
    });
  }, [workCenters, grid]);

  return (
    <div className="p-6 space-y-4">
      <Breadcrumb items={[{ label: "MFG" }, { label: "Production Calendar" }]} />

      <div className="flex items-center gap-3">
        <button
          onClick={() => setWeekOffset(o => o - 1)}
          className="px-3 py-1.5 text-xs rounded border border-line hover:bg-surface-2"
        >
          &larr; Prev
        </button>
        <span className="text-sm font-medium">
          {weeks[0].toLocaleDateString("en", { month: "short", day: "numeric" })}
          {" – "}
          {addWeeks(weeks[3], 1).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" })}
        </span>
        <button
          onClick={() => setWeekOffset(o => o + 1)}
          className="px-3 py-1.5 text-xs rounded border border-line hover:bg-surface-2"
        >
          Next &rarr;
        </button>
        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            className="px-3 py-1.5 text-xs rounded border border-line text-accent hover:bg-accent/10"
          >
            Today
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(Object.entries(STATUS_COLORS) as [WOStatus, string][]).map(([s, cls]) => (
          <span key={s} className={`px-2 py-0.5 rounded ${cls}`}>{s.replace("_", " ")}</span>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-ink-3">Loading...</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-ink-3 w-40 border-b border-line">Work Center</th>
                {weeks.map(w => (
                  <th key={weekKey(w)} className="px-3 py-2 text-left text-xs font-medium text-ink-3 min-w-[180px] border-b border-line">
                    {w.toLocaleDateString("en", { month: "short", day: "numeric" })}
                    {" – "}
                    {addWeeks(w, 1).toLocaleDateString("en", { month: "short", day: "numeric" })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-3">
                    No work orders scheduled in this period
                  </td>
                </tr>
              )}
              {visibleRows.map(row => (
                <tr key={row.id} className="border-t border-line align-top">
                  <td className="px-4 py-3 font-medium text-xs whitespace-nowrap">{row.name}</td>
                  {weeks.map(w => {
                    const wos = grid.get(row.id)?.get(weekKey(w)) ?? [];
                    return (
                      <td key={weekKey(w)} className="px-2 py-2 align-top">
                        <div className="space-y-1 min-h-[32px]">
                          {wos.map(wo => (
                            <div key={wo.id} className={`px-2 py-1 rounded text-xs ${STATUS_COLORS[wo.status]}`}>
                              <div className="font-mono font-semibold">{wo.code}</div>
                              <div className="opacity-75">qty {wo.qty}</div>
                            </div>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
