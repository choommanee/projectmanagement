"use client";
import { useEffect, useMemo, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listAudit, getBuckets, type AuditEvent, type Bucket } from "@/lib/api/audit";

const SERVICES = [
  { id: "tenant-svc",    name: "Tenant" },
  { id: "identity-svc",  name: "Identity" },
  { id: "project-svc",   name: "Project" },
  { id: "document-svc",  name: "Document" },
  { id: "mfg-svc",       name: "Manufacturing" },
  { id: "quality-svc",   name: "Quality" },
  { id: "workflow-svc",  name: "Workflow" },
  { id: "audit-svc",     name: "Audit" },
  { id: "hr-svc",        name: "HR" },
  { id: "sales-svc",     name: "Sales" },
  { id: "accounting-svc",name: "Accounting" },
  { id: "reports-svc",   name: "Reports" },
];

export default function SystemHealthPage() {
  const [recentEvents, setRecentEvents] = useState<AuditEvent[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      listAudit({ limit: 20 }).then(r => setRecentEvents(r.items)),
      getBuckets(14).then(setBuckets),
    ]).finally(() => setLoading(false));
  }, []);

  const serviceActivity = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of buckets) {
      m.set(b.service, (m.get(b.service) ?? 0) + b.count);
    }
    return m;
  }, [buckets]);

  const dailyTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of buckets) {
      m.set(b.day, (m.get(b.day) ?? 0) + b.count);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
  }, [buckets]);

  const maxDaily = Math.max(1, ...dailyTotals.map(([, c]) => c));
  const successCount = recentEvents.filter(e => e.result === "ok" || e.result === "allow").length;
  const errorCount = recentEvents.filter(e => e.result !== "ok" && e.result !== "allow").length;

  return (
    <div className="p-6 space-y-6">
      <Breadcrumb items={[{ label: "Admin" }, { label: "System Health" }]} />

      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Services</div>
          <div className="text-2xl font-mono font-bold">{SERVICES.length}</div>
          <div className="text-xs text-ink-3 mt-1">registered</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Events (14d)</div>
          <div className="text-2xl font-mono font-bold">{buckets.reduce((s, b) => s + b.count, 0)}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Success (recent)</div>
          <div className="text-2xl font-mono font-bold text-green-600">{successCount}</div>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="text-xs text-ink-3 mb-1">Errors (recent)</div>
          <div className={`text-2xl font-mono font-bold ${errorCount > 0 ? "text-red-600" : "text-green-600"}`}>{errorCount}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-medium mb-3">Daily Activity (7 days)</h3>
          {dailyTotals.length === 0 ? (
            <div className="text-xs text-ink-3">No data</div>
          ) : (
            <div className="flex items-end gap-1 h-24">
              {dailyTotals.map(([day, count]) => (
                <div key={day} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-accent/70 rounded-t"
                    style={{ height: `${Math.round(count / maxDaily * 80)}px` }}
                  />
                  <div className="text-xs text-ink-3" style={{ fontSize: "9px" }}>
                    {day.slice(5)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-line bg-surface p-4">
          <h3 className="text-sm font-medium mb-3">Activity by Service (14d)</h3>
          <div className="space-y-1.5">
            {SERVICES.map(svc => {
              const count = serviceActivity.get(svc.id) ?? 0;
              const maxCount = Math.max(1, ...serviceActivity.values());
              return (
                <div key={svc.id} className="flex items-center gap-2">
                  <span className="text-xs text-ink-3 w-24 truncate">{svc.name}</span>
                  <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                    <div className="h-full bg-accent/60 rounded-full" style={{ width: `${count / maxCount * 100}%` }} />
                  </div>
                  <span className="text-xs font-mono w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-ink-3">Loading…</div>
      ) : (
        <div className="rounded-lg border border-line overflow-hidden">
          <div className="px-4 py-3 bg-surface-2 text-sm font-medium">Recent Events</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-ink-3 uppercase bg-surface-2">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Service</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
                <th className="px-4 py-2 text-left font-medium">Entity</th>
                <th className="px-4 py-2 text-left font-medium">Result</th>
                <th className="px-4 py-2 text-left font-medium">User</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-ink-3">No recent events</td></tr>
              )}
              {recentEvents.map(ev => (
                <tr key={ev.id} className="border-t border-line hover:bg-surface-2">
                  <td className="px-4 py-2 text-xs font-mono text-ink-3">{new Date(ev.ts).toLocaleTimeString()}</td>
                  <td className="px-4 py-2 text-xs">{ev.service}</td>
                  <td className="px-4 py-2 text-xs font-mono">{ev.action}</td>
                  <td className="px-4 py-2 text-xs text-ink-3">{ev.entityType}</td>
                  <td className="px-4 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${ev.result === "ok" || ev.result === "allow" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                      {ev.result}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-3 font-mono">{ev.userId?.slice(0, 8)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
