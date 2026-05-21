"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import { RefreshCw, Download, ChevronDown, ChevronRight, Search } from "lucide-react";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listAudit, getBuckets,
  type AuditEvent, type Bucket, type ListAuditOpts,
} from "@/lib/api/audit";

// ── helpers ────────────────────────────────────────────────────────────────

function resultTone(r: string): "success" | "warning" | "danger" | "neutral" {
  if (r === "success") return "success";
  if (r === "denied")  return "warning";
  if (r === "error")   return "danger";
  return "neutral";
}

// Consistent per-service accent colours (cycled if more services than palette)
const SVC_PALETTE = [
  "bg-accent-soft text-accent",
  "bg-info/15 text-info",
  "bg-success/15 text-success",
  "bg-signal-soft text-signal",
  "bg-warning/15 text-warning",
  "bg-surface-3 text-ink-2",
];
const svcColorCache: Record<string, string> = {};
let svcColorIdx = 0;
function svcColor(service: string): string {
  if (!svcColorCache[service]) {
    svcColorCache[service] = SVC_PALETTE[svcColorIdx % SVC_PALETTE.length];
    svcColorIdx++;
  }
  return svcColorCache[service];
}

function fmtTs(ts: string): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return ts;
  }
}

function shortId(id: string): string {
  return id ? id.substring(0, 8) : "";
}

// ── Sparkline chart component ──────────────────────────────────────────────

interface SparklineProps {
  buckets: Bucket[];
  onSelectDay?: (day: string, service: string) => void;
}

function SparklineChart({ buckets, onSelectDay }: SparklineProps) {
  if (!buckets.length) return null;

  // Group by service, collect last 14 days
  const today = new Date();
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().substring(0, 10));
  }

  const byService: Record<string, Record<string, number>> = {};
  for (const b of buckets) {
    if (!byService[b.service]) byService[b.service] = {};
    byService[b.service][b.day] = b.count;
  }
  const services = Object.keys(byService).sort();

  return (
    <div className="border-b border-line bg-paper px-3 py-3">
      <p className="mb-2 text-[11px] font-medium text-ink-3 uppercase tracking-wide">14-day activity</p>
      <div className="flex flex-col gap-2">
        {services.map((svc) => {
          const counts = days.map((d) => byService[svc][d] ?? 0);
          const maxCount = Math.max(...counts, 1);
          const color = svcColor(svc);
          return (
            <div key={svc} className="flex items-center gap-2">
              <span
                className={`inline-flex h-5 items-center rounded-xs px-1.5 text-[11px] font-medium shrink-0 w-32 truncate ${color}`}
              >
                {svc}
              </span>
              <div className="flex items-end gap-px h-6">
                {days.map((day, i) => {
                  const cnt = counts[i];
                  const h = cnt === 0 ? 2 : Math.max(4, Math.round((cnt / maxCount) * 22));
                  return (
                    <button
                      key={day}
                      title={`${day}: ${cnt} events`}
                      className={`w-3 rounded-[1px] opacity-80 hover:opacity-100 transition-opacity cursor-pointer ${
                        cnt === 0 ? "bg-surface-2" : "bg-accent"
                      }`}
                      style={{ height: `${h}px` }}
                      onClick={() => cnt > 0 && onSelectDay?.(day, svc)}
                    />
                  );
                })}
              </div>
              <span className="text-[11px] text-ink-3 tabular-nums ml-1">
                {counts.reduce((a, b) => a + b, 0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Filter toolbar ─────────────────────────────────────────────────────────

interface Filters extends ListAuditOpts {}

interface ToolbarProps {
  filters: Filters;
  services: string[];
  onChange: (f: Filters) => void;
  onApply: () => void;
  onClear: () => void;
}

function FilterToolbar({ filters, services, onChange, onApply, onClear }: ToolbarProps) {
  const [local, setLocal] = useState<Filters>(filters);

  useEffect(() => { setLocal(filters); }, [filters]);

  function set(k: keyof Filters, v: string) {
    setLocal((prev) => ({ ...prev, [k]: v || undefined }));
  }

  return (
    <div className="border-b border-line bg-paper px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Service select */}
        <select
          className="h-8 rounded border border-line bg-paper px-2 text-[13px] text-ink-1 focus:outline-none focus:ring-1 focus:ring-accent"
          value={local.service ?? ""}
          onChange={(e) => set("service", e.target.value)}
        >
          <option value="">All services</option>
          {services.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Action */}
        <Input
          value={local.action ?? ""}
          onChange={(e) => set("action", e.target.value)}
          placeholder="action"
          className="h-8 w-36 text-[13px] font-mono"
        />

        {/* Entity type */}
        <Input
          value={local.entityType ?? ""}
          onChange={(e) => set("entityType", e.target.value)}
          placeholder="entity_type"
          className="h-8 w-32 text-[13px] font-mono"
        />

        {/* Entity id */}
        <Input
          value={local.entityId ?? ""}
          onChange={(e) => set("entityId", e.target.value)}
          placeholder="entity_id"
          className="h-8 w-36 text-[13px] font-mono"
        />

        {/* User id */}
        <Input
          value={local.userId ?? ""}
          onChange={(e) => set("userId", e.target.value)}
          placeholder="user_id"
          className="h-8 w-36 text-[13px] font-mono"
        />

        {/* Result select */}
        <select
          className="h-8 rounded border border-line bg-paper px-2 text-[13px] text-ink-1 focus:outline-none focus:ring-1 focus:ring-accent"
          value={local.result ?? ""}
          onChange={(e) => set("result", e.target.value)}
        >
          <option value="">All results</option>
          <option value="success">success</option>
          <option value="denied">denied</option>
          <option value="error">error</option>
        </select>

        {/* From date */}
        <input
          type="date"
          className="h-8 rounded border border-line bg-paper px-2 text-[13px] text-ink-1 focus:outline-none focus:ring-1 focus:ring-accent"
          value={local.from ?? ""}
          onChange={(e) => set("from", e.target.value)}
        />

        {/* To date */}
        <input
          type="date"
          className="h-8 rounded border border-line bg-paper px-2 text-[13px] text-ink-1 focus:outline-none focus:ring-1 focus:ring-accent"
          value={local.to ?? ""}
          onChange={(e) => set("to", e.target.value)}
        />

        {/* Full-text search */}
        <div className="relative">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input
            value={local.q ?? ""}
            onChange={(e) => set("q", e.target.value)}
            placeholder="search…"
            className="h-8 w-36 pl-6 text-[13px]"
          />
        </div>

        <Button variant="primary" onClick={() => { onChange(local); onApply(); }} className="h-8 text-[13px]">
          Apply
        </Button>
        <Button variant="ghost" onClick={() => { setLocal({}); onChange({}); onClear(); }} className="h-8 text-[13px]">
          Clear
        </Button>
      </div>
    </div>
  );
}

// ── Row detail expand ──────────────────────────────────────────────────────

function JsonBlock({ label, data }: { label: string; data: Record<string, unknown> | null }) {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <pre className="rounded bg-surface-2 p-2 font-mono text-[11px] text-ink-1 overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function EventRow({ ev, expanded, onToggle }: { ev: AuditEvent; expanded: boolean; onToggle: () => void }) {
  const entity = ev.entityType && ev.entityId
    ? `${ev.entityType}#${shortId(ev.entityId)}`
    : ev.entityType || ev.entityId || "—";
  const hasDetail = ev.before || ev.after || ev.meta;

  return (
    <>
      <tr
        className={`border-b border-line text-[12px] cursor-pointer ${expanded ? "bg-accent-soft/30" : "hover:bg-surface-2/60"} transition-colors`}
        onClick={onToggle}
      >
        <td className="px-3 py-1.5 font-mono text-ink-2 whitespace-nowrap">{fmtTs(ev.ts)}</td>
        <td className="px-3 py-1.5 whitespace-nowrap">
          <span className={`inline-flex h-5 items-center rounded-xs px-1.5 text-[11px] font-medium ${svcColor(ev.service)}`}>
            {ev.service}
          </span>
        </td>
        <td className="px-3 py-1.5 font-mono text-ink-1 whitespace-nowrap">{ev.action}</td>
        <td className="px-3 py-1.5 font-mono text-ink-3 whitespace-nowrap">{entity}</td>
        <td className="px-3 py-1.5 font-mono text-ink-3 whitespace-nowrap">{shortId(ev.userId)}</td>
        <td className="px-3 py-1.5 whitespace-nowrap">
          <Tag tone={resultTone(ev.result)} dot>{ev.result}</Tag>
        </td>
        <td className="px-3 py-1.5 font-mono text-ink-3 text-[11px] whitespace-nowrap">{ev.ip || "—"}</td>
        <td className="px-3 py-1.5 text-ink-3">
          {hasDetail
            ? (expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)
            : null}
        </td>
      </tr>
      {expanded && hasDetail && (
        <tr className="border-b border-line">
          <td colSpan={8} className="bg-surface-2/40 px-4 py-3">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div><span className="text-ink-3">id: </span><span className="font-mono text-ink-2">{ev.id}</span></div>
                {ev.userId && <div><span className="text-ink-3">user: </span><span className="font-mono text-ink-2">{ev.userId}</span></div>}
                {ev.entityType && <div><span className="text-ink-3">entity: </span><span className="font-mono text-ink-2">{ev.entityType}/{ev.entityId}</span></div>}
              </div>
              <JsonBlock label="before" data={ev.before} />
              <JsonBlock label="after" data={ev.after} />
              <JsonBlock label="meta" data={ev.meta} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export default function AuditPage() {
  const [items, setItems] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<ListAuditOpts>({});
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Derive unique services from buckets + current items
  const services = Array.from(new Set([
    ...buckets.map((b) => b.service),
    ...items.map((e) => e.service),
  ])).sort();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [evRes, bkts] = await Promise.all([
        listAudit({ ...filters, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
        getBuckets(14),
      ]);
      setItems(evRes.items);
      setTotal(evRes.total);
      setBuckets(bkts);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { refresh(); }, [refresh]);

  function handleSparkClick(day: string, service: string) {
    setFilters((prev) => ({ ...prev, service, from: day, to: day }));
    setPage(0);
  }

  function exportCsv() {
    const headers = ["ts","service","action","entity","user_id","result","ip","id"];
    const rows = items.map((e) => [
      fmtTs(e.ts), e.service, e.action,
      `${e.entityType}#${e.entityId}`.replace(/^#|#$/, ""),
      e.userId, e.result, e.ip, e.id,
    ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-${new Date().toISOString().substring(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Audit Explorer" }]} />
      <CommandBar
        actions={[
          {
            id: "refresh", label: "Refresh", variant: "ghost",
            icon: <RefreshCw size={14} />,
            onClick: () => startTransition(() => { refresh(); }),
          },
          { kind: "separator", id: "s1" },
          {
            id: "export", label: "Export CSV", variant: "ghost",
            icon: <Download size={14} />,
            onClick: exportCsv,
          },
        ]}
      />

      {/* Sparklines */}
      <SparklineChart buckets={buckets} onSelectDay={handleSparkClick} />

      {/* Filters */}
      <FilterToolbar
        filters={filters}
        services={services}
        onChange={setFilters}
        onApply={() => { setPage(0); refresh(); }}
        onClear={() => { setPage(0); }}
      />

      {/* Error */}
      {error && (
        <div className="mx-3 mt-2 rounded border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-paper border-b border-line">
            <tr>
              {["Timestamp","Service","Action","Entity","User","Result","IP",""].map((h, i) => (
                <th key={i} className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-[13px] text-ink-3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-[13px] text-ink-3">
                  No audit events found. Try adjusting filters or trigger a login.
                </td>
              </tr>
            )}
            {items.map((ev) => (
              <EventRow
                key={ev.id}
                ev={ev}
                expanded={expandedId === ev.id}
                onToggle={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      <div className="flex items-center justify-between border-t border-line bg-paper px-3 py-2">
        <span className="text-[12px] text-ink-3">
          {total === 0 ? "No events" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total}`}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="h-7 px-2 text-[12px]"
          >
            Prev
          </Button>
          <span className="text-[12px] text-ink-3 px-1">
            {page + 1} / {totalPages || 1}
          </span>
          <Button
            variant="ghost"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="h-7 px-2 text-[12px]"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
