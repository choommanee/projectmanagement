"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Tag } from "@pmplatform/ui-kit";
import { listAudit, type AuditEvent } from "@/lib/api/audit";

function resultTone(r: string): "success" | "danger" {
  return r === "ok" || r === "allow" ? "success" : "danger";
}

export default function AdminAuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    listAudit({ limit: 100 })
      .then((r) => setEvents(r.items))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Audit Log" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Audit Log</h1>
        <Button variant="ghost" size="sm" onClick={load}>Refresh</Button>
      </div>

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Service</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
                <th className="px-4 py-2 text-left font-medium">Entity</th>
                <th className="px-4 py-2 text-left font-medium">User</th>
                <th className="px-4 py-2 text-left font-medium">Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-ink-3">No audit events found.</td>
                </tr>
              ) : events.map((ev) => (
                <tr key={ev.id} className="hover:bg-surface/50">
                  <td className="px-4 py-2 font-mono text-xs text-ink-3">
                    {ev.ts ? new Date(ev.ts).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs">{ev.service || "—"}</td>
                  <td className="px-4 py-2">
                    <Tag tone="info" size="sm">{ev.action || "—"}</Tag>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-3">
                    {ev.entityType && ev.entityId ? `${ev.entityType}/${ev.entityId.slice(0, 8)}` : "—"}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-3">
                    {ev.userId ? ev.userId.slice(0, 8) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Tag tone={resultTone(ev.result)} size="sm">{ev.result || "—"}</Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
