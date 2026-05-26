"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Tag } from "@pmplatform/ui-kit";
import { listWorkOrders, listWorkCenters, type WorkOrder, type WorkCenter, type WOStatus } from "@/lib/api/mfg";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAY_WIDTH = 80; // px per day column
const ROW_HEIGHT = 56; // px per work center row
const LABEL_WIDTH = 160; // px for left label column
const DAYS_SHOWN = 21; // 3 weeks

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "planned", label: "Planned" },
  { value: "released", label: "Released" },
  { value: "in_progress", label: "In Progress" },
];

function woCardColor(status: WOStatus): string {
  if (status === "planned") return "bg-surface-2 border-line text-ink";
  if (status === "released") return "bg-info/10 border-info/30 text-info";
  if (status === "in_progress") return "bg-accent/10 border-accent/30 text-accent";
  if (status === "completed") return "bg-success/10 border-success/30 text-success";
  if (status === "cancelled") return "bg-danger/10 border-danger/30 text-danger";
  return "bg-surface-2 border-line text-ink";
}

// Build array of Date objects for the board columns
function buildDays(anchor: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(anchor);
    d.setDate(anchor.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayIndex(days: Date[], d: Date): number {
  return days.findIndex(day => isSameDay(day, d));
}

// ─── WO Card ─────────────────────────────────────────────────────────────────

function WOCard({ wo, dayIdx, days }: { wo: WorkOrder; dayIdx: number; days: Date[] }) {
  const dueD = wo.dueDate ? new Date(wo.dueDate) : null;
  const startIdx = wo.startAt ? dayIndex(days, new Date(wo.startAt)) : dayIdx;
  const endIdx = wo.endAt ? dayIndex(days, new Date(wo.endAt)) : dayIdx;
  const span = Math.max(1, endIdx - startIdx + 1);

  return (
    <div
      title={`${wo.code} — ${wo.status}${dueD ? ` due ${dueD.toLocaleDateString()}` : ""}`}
      className={`absolute top-1 flex h-10 flex-col justify-center overflow-hidden rounded-xs border px-2 text-[10px] leading-tight shadow-sm ${woCardColor(wo.status)}`}
      style={{
        left: startIdx >= 0 ? startIdx * DAY_WIDTH + 2 : 0,
        width: span * DAY_WIDTH - 4,
      }}
    >
      <div className="truncate font-mono font-semibold">{wo.code}</div>
      <div className="truncate text-ink-3">{wo.itemId.slice(0, 8)}</div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SchedulingPage() {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [workCenters, setWorkCenters] = useState<WorkCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const days = useMemo(() => buildDays(today, DAYS_SHOWN), [today]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [woRes, wcList] = await Promise.all([
        listWorkOrders({ status: statusFilter || undefined, limit: 200 }),
        listWorkCenters(),
      ]);
      setWorkOrders(woRes.items);
      setWorkCenters(wcList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load scheduling data");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group work orders by work center
  const woByWC = useMemo(() => {
    const map = new Map<string, WorkOrder[]>();
    for (const wo of workOrders) {
      if (!wo.workCenterId) continue;
      const list = map.get(wo.workCenterId) ?? [];
      list.push(wo);
      map.set(wo.workCenterId, list);
    }
    return map;
  }, [workOrders]);

  // Unscheduled = no workCenterId or dueDate falls outside window
  const unscheduled = useMemo(() =>
    workOrders.filter(wo => {
      if (!wo.workCenterId) return true;
      if (!wo.dueDate) return true;
      const d = new Date(wo.dueDate);
      d.setHours(0, 0, 0, 0);
      return dayIndex(days, d) < 0;
    }),
    [workOrders, days]
  );

  const todayColIdx = dayIndex(days, today);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Scheduling Board" }]} />
      <CommandBar actions={[
        { id: "refresh", label: "Refresh", variant: "ghost", onClick: load },
      ]} />

      {/* Filters */}
      <div className="flex items-center gap-3 border-b border-line bg-paper px-4 py-2">
        <span className="text-xs font-medium text-ink-3">Status</span>
        <div className="flex gap-1">
          {STATUS_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`rounded-xs px-3 py-1 text-xs font-medium transition-colors ${statusFilter === opt.value ? "bg-accent text-white" : "text-ink-2 hover:bg-surface-2"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-ink-3">{workOrders.length} work orders across {workCenters.length} work centers</span>
      </div>

      {error && <div className="m-4 rounded-sm bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="space-y-px w-full">
            {[1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse border-b border-line bg-surface-2" />)}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Gantt board */}
          <div className="flex-1 overflow-auto">
            <div style={{ minWidth: LABEL_WIDTH + DAY_WIDTH * DAYS_SHOWN }}>
              {/* Header row */}
              <div className="sticky top-0 z-10 flex border-b-2 border-line bg-surface-2">
                <div
                  className="flex-shrink-0 border-r border-line px-3 py-2 text-xs font-semibold text-ink-3"
                  style={{ width: LABEL_WIDTH }}
                >
                  Work Center
                </div>
                {days.map((d, i) => {
                  const isToday = i === todayColIdx;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div
                      key={i}
                      className={`flex-shrink-0 border-r border-line px-1 py-2 text-center text-[10px] font-medium ${isToday ? "bg-accent/10 text-accent" : isWeekend ? "bg-surface-2 text-ink-3" : "text-ink-2"}`}
                      style={{ width: DAY_WIDTH }}
                    >
                      <div>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]}</div>
                      <div className="font-mono">{d.getDate()}/{d.getMonth() + 1}</div>
                    </div>
                  );
                })}
              </div>

              {/* Work center rows */}
              {workCenters.map((wc) => {
                const wos = woByWC.get(wc.id) ?? [];
                return (
                  <div
                    key={wc.id}
                    className="flex border-b border-line hover:bg-surface-2/50"
                    style={{ height: ROW_HEIGHT }}
                  >
                    {/* Label */}
                    <div
                      className="flex flex-shrink-0 flex-col justify-center border-r border-line px-3"
                      style={{ width: LABEL_WIDTH }}
                    >
                      <div className="truncate text-xs font-semibold text-ink">{wc.name}</div>
                      <div className="font-mono text-[10px] text-ink-3">{wc.code}</div>
                    </div>

                    {/* Day cells + WO cards */}
                    <div className="relative flex-1">
                      {/* Day cell grid lines */}
                      {days.map((d, i) => {
                        const isToday = i === todayColIdx;
                        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                        return (
                          <div
                            key={i}
                            className={`absolute top-0 h-full border-r border-line ${isToday ? "bg-accent/5" : isWeekend ? "bg-surface-2/40" : ""}`}
                            style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                          />
                        );
                      })}

                      {/* WO cards */}
                      {wos.map((wo) => {
                        const dueDate = wo.dueDate ? new Date(wo.dueDate) : null;
                        if (!dueDate) return null;
                        dueDate.setHours(0, 0, 0, 0);
                        const colIdx = dayIndex(days, dueDate);
                        if (colIdx < 0) return null;
                        return (
                          <WOCard key={wo.id} wo={wo} dayIdx={colIdx} days={days} />
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {workCenters.length === 0 && !loading && (
                <div className="flex items-center justify-center py-12 text-sm text-ink-3">
                  No work centers configured.
                </div>
              )}
            </div>
          </div>

          {/* Unscheduled sidebar */}
          {unscheduled.length > 0 && (
            <div className="w-52 flex-shrink-0 overflow-y-auto border-l border-line bg-paper">
              <div className="border-b border-line px-3 py-2 text-xs font-semibold text-ink-3">
                Unscheduled ({unscheduled.length})
              </div>
              <ul className="space-y-1 p-2">
                {unscheduled.map((wo) => (
                  <li
                    key={wo.id}
                    className={`rounded-xs border px-2 py-1.5 text-[10px] ${woCardColor(wo.status)}`}
                  >
                    <div className="font-mono font-semibold">{wo.code}</div>
                    <div className="mt-0.5 flex items-center gap-1">
                      <Tag tone={wo.status === "planned" ? "neutral" : wo.status === "released" ? "info" : "accent"}>
                        {wo.status}
                      </Tag>
                    </div>
                    {wo.dueDate && (
                      <div className="mt-0.5 text-ink-3">
                        Due {new Date(wo.dueDate).toLocaleDateString()}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
