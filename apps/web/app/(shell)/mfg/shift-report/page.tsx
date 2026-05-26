"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Tag } from "@pmplatform/ui-kit";
import { listWorkOrders, type WorkOrder } from "@/lib/api/mfg";

const SHIFTS = [
  { id: "morning",   label: "Morning",   start: 6,  end: 14 },
  { id: "afternoon", label: "Afternoon", start: 14, end: 22 },
  { id: "night",     label: "Night",     start: 22, end: 6  },
];

function getShift(date: Date): string {
  const h = date.getHours();
  if (h >= 6 && h < 14) return "morning";
  if (h >= 14 && h < 22) return "afternoon";
  return "night";
}

function exportCSV(filename: string, rows: string[][]): void {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ShiftReportPage() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().split("T")[0]);
  const [selectedShift, setSelectedShift] = useState<string>("morning");

  useEffect(() => {
    listWorkOrders({ limit: 200 })
      .then((result) => setWorkOrders(result.items))
      .catch(() => setWorkOrders([]))
      .finally(() => setLoading(false));
  }, []);

  const shiftWOs = useMemo(() => {
    return workOrders.filter((wo) => {
      const ts = wo.updatedAt || wo.createdAt;
      if (!ts) return false;
      const d = new Date(ts);
      const dateMatch = d.toISOString().split("T")[0] === selectedDate;
      const shiftMatch = getShift(d) === selectedShift;
      return dateMatch && shiftMatch;
    });
  }, [workOrders, selectedDate, selectedShift]);

  const summary = useMemo(() => {
    const total = shiftWOs.length;
    const completed = shiftWOs.filter((w) => w.status === "completed").length;
    const inProgress = shiftWOs.filter((w) => w.status === "in_progress").length;
    const planned = shiftWOs.filter((w) => w.status === "planned" || w.status === "released").length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, planned, completionRate };
  }, [shiftWOs]);

  const shiftLabel = SHIFTS.find((s) => s.id === selectedShift)?.label ?? "";

  function handleExport() {
    exportCSV(`shift-report-${selectedDate}-${selectedShift}.csv`, [
      ["WO Code", "Item ID", "Status", "Qty", "Work Center", "Updated"],
      ...shiftWOs.map((wo) => [
        wo.code ?? wo.id.slice(0, 8),
        wo.itemId ?? "—",
        wo.status,
        String(wo.qty ?? "—"),
        wo.workCenterId ?? "—",
        wo.updatedAt ?? wo.createdAt ?? "—",
      ]),
    ]);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <Breadcrumb items={[{ label: "MFG", href: "/mfg/home" }, { label: "Shift Report" }]} />

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Shift Report</h1>
        <Button variant="ghost" size="sm" onClick={handleExport} disabled={shiftWOs.length === 0}>
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium text-ink-muted">Date</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="rounded border border-line bg-surface px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </label>
        <div className="flex rounded border border-line overflow-hidden">
          {SHIFTS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedShift(s.id)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${selectedShift === s.id ? "bg-accent text-white" : "bg-surface hover:bg-surface-2 text-ink"}`}
            >
              {s.label} ({String(s.start).padStart(2, "0")}:00–{String(s.end).padStart(2, "0")}:00)
            </button>
          ))}
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[
          { label: "Total WOs", value: summary.total, color: "text-ink" },
          { label: "Completed", value: summary.completed, color: "text-success" },
          { label: "In Progress", value: summary.inProgress, color: "text-info" },
          { label: "Planned/Released", value: summary.planned, color: "text-warning" },
          { label: "Completion %", value: `${summary.completionRate}%`, color: summary.completionRate >= 80 ? "text-success" : summary.completionRate >= 50 ? "text-warning" : "text-danger" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-sm border border-line bg-surface p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{tile.label}</p>
            <p className={`font-mono text-2xl font-bold tabular-nums ${tile.color}`}>{tile.value}</p>
          </div>
        ))}
      </div>

      {/* Work order list */}
      <div>
        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-3">
          {shiftLabel} Shift — {selectedDate} ({shiftWOs.length} work orders)
        </h2>

        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-ink-muted">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">WO Code</th>
                  <th className="px-4 py-2 text-left font-medium">Item</th>
                  <th className="px-4 py-2 text-right font-medium">Qty</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Work Center</th>
                  <th className="px-4 py-2 text-left font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shiftWOs.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-muted">No work orders found for this shift.</td></tr>
                ) : shiftWOs.map((wo) => (
                  <tr key={wo.id} className="hover:bg-surface-2/50">
                    <td className="px-4 py-2 font-mono text-xs">{wo.code ?? wo.id.slice(0, 8)}</td>
                    <td className="px-4 py-2 text-ink-muted font-mono text-xs">{wo.itemId ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono">{wo.qty ?? "—"}</td>
                    <td className="px-4 py-2">
                      <Tag
                        tone={wo.status === "completed" ? "success" : wo.status === "in_progress" ? "info" : wo.status === "cancelled" ? "danger" : "neutral"}
                        size="sm"
                      >
                        {wo.status}
                      </Tag>
                    </td>
                    <td className="px-4 py-2 text-ink-muted font-mono text-xs">{wo.workCenterId ?? "—"}</td>
                    <td className="px-4 py-2 text-ink-muted">
                      {wo.updatedAt ? new Date(wo.updatedAt).toLocaleTimeString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
