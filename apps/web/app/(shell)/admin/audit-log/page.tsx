"use client";
import { useCallback, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";

interface AuditEvent {
  id: string;
  actor_id: string;
  actor_email?: string;
  action: string;
  resource_type: string;
  resource_id: string;
  occurred_at: string;
  tenant_id?: string;
}

export default function AdminAuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/audit/events")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setEvents(Array.isArray(data) ? data : (data?.events ?? [])))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Audit Log" }]} />
      <h1 className="text-xl font-semibold">Audit Log</h1>

      {loading ? (
        <p className="text-sm text-ink-3">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-ink-3">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Time</th>
                <th className="px-4 py-2 text-left font-medium">Actor</th>
                <th className="px-4 py-2 text-left font-medium">Action</th>
                <th className="px-4 py-2 text-left font-medium">Resource</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-ink-3">No audit events found.</td>
                </tr>
              ) : events.map((ev) => (
                <tr key={ev.id} className="hover:bg-surface/50">
                  <td className="px-4 py-2 font-mono text-xs text-ink-3">
                    {new Date(ev.occurred_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">{ev.actor_email ?? ev.actor_id}</td>
                  <td className="px-4 py-2">
                    <Tag tone="info" size="sm">{ev.action}</Tag>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-3">
                    {ev.resource_type}/{ev.resource_id}
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
