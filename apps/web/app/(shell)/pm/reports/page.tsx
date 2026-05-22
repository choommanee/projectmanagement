"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pin, Pencil, Trash2, ArrowUpRight, Activity, Gauge, ShieldAlert } from "lucide-react";
import { Button, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listDashboards,
  deleteDashboard,
  getSummaryMetrics,
  type Dashboard,
  type SummaryMetrics,
} from "@/lib/api/reports";

// ─── Prebuilt definitions (industrial, no pastel) ───────────────────────────

const PREBUILT = [
  {
    key: "exec",
    code: "EXEC-01",
    name: "Executive Overview",
    description: "Cross-functional KPIs across projects, tasks, workflows, and audit activity.",
    icon: Activity,
    fields: ["projects.active", "tasks.open", "workflowRunsToday", "auditEvents24h"] as const,
    fieldLabels: ["projects active", "tasks open", "wf runs today", "audit / 24h"],
  },
  {
    key: "mfg",
    code: "MFG-01",
    name: "Manufacturing",
    description: "Work order status, throughput, and MRP release trends.",
    icon: Gauge,
    fields: ["workOrders.total", "workOrders.released", "workOrders.inProgress", "workOrders.completed"] as const,
    fieldLabels: ["wo total", "released", "in progress", "completed"],
  },
  {
    key: "quality",
    code: "QC-01",
    name: "Quality",
    description: "NCR open count, FMEA high-RPN items, and audit event trends.",
    icon: ShieldAlert,
    fields: ["ncrsOpen", "fmeaHighRpn", "documents.draft", "documents.approved"] as const,
    fieldLabels: ["ncrs open", "fmea > 100", "docs draft", "docs approved"],
  },
];

function resolveField(summary: SummaryMetrics | null, field: string): number {
  if (!summary) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = summary;
  for (const p of field.split(".")) {
    if (cur == null) return 0;
    cur = cur[p];
  }
  return typeof cur === "number" ? cur : 0;
}

function visibilityTone(v: Dashboard["visibility"]): "success" | "warning" | "neutral" {
  switch (v) {
    case "tenant": return "success";
    case "team": return "warning";
    default: return "neutral";
  }
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "m";
  if (n >= 10_000) return (n / 1_000).toFixed(1) + "k";
  return n.toLocaleString();
}

// ─── Top "instrument strip" — live primary KPIs ─────────────────────────────

const PRIMARY_KPIS: { field: string; label: string; tone?: "signal" }[] = [
  { field: "projects.total",       label: "projects" },
  { field: "projects.active",      label: "active" },
  { field: "tasks.open",           label: "tasks open" },
  { field: "tasks.overdue",        label: "overdue",        tone: "signal" },
  { field: "workOrders.released",  label: "wo released" },
  { field: "ncrsOpen",             label: "ncrs open",      tone: "signal" },
  { field: "workflowRunsToday",    label: "wf today" },
  { field: "auditEvents24h",       label: "audit / 24h" },
];

function InstrumentStrip({ summary, loading }: { summary: SummaryMetrics | null; loading: boolean }) {
  return (
    <section
      className="relative overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs"
      aria-label="Live tenant KPI strip"
    >
      {/* Faint blueprint grid background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="relative grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-y divide-line lg:divide-y-0 lg:divide-x">
        {PRIMARY_KPIS.map((k, idx) => {
          const v = resolveField(summary, k.field);
          const isAlert = k.tone === "signal" && v > 0;
          return (
            <div
              key={k.field}
              className="group relative flex flex-col gap-1 px-4 py-4 sm:py-5 reveal"
              style={{ animationDelay: `${idx * 40}ms` }}
            >
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    isAlert ? "bg-signal" : "bg-accent"
                  } ${loading ? "" : "animate-pulse-soft"}`}
                />
                {k.label}
              </div>
              <div
                className={`font-mono text-[26px] font-semibold leading-none tabular-nums ${
                  isAlert ? "text-signal" : "text-ink"
                }`}
              >
                {loading ? <span className="inline-block h-7 w-12 animate-pulse rounded bg-surface-2" /> : formatNum(v)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Prebuilt "instrument card" ─────────────────────────────────────────────

function PrebuiltCard({
  def,
  summary,
  loading,
  onOpen,
  index,
}: {
  def: (typeof PREBUILT)[number];
  summary: SummaryMetrics | null;
  loading: boolean;
  onOpen: () => void;
  index: number;
}) {
  const Icon = def.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${200 + index * 80}ms` }}
      className="reveal group relative flex flex-col gap-4 overflow-hidden rounded-lg border border-line-strong bg-surface p-5 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-pop focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      {/* Hover accent bar */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px] origin-left scale-x-0 bg-accent transition-transform duration-300 group-hover:scale-x-100"
      />

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
            <span className="rounded-sm border border-line-strong bg-paper px-1.5 py-0.5">{def.code}</span>
            prebuilt
          </div>
          <div className="text-base font-semibold text-ink">{def.name}</div>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-paper text-ink-2 transition-colors group-hover:border-accent group-hover:text-accent">
          <Icon size={16} strokeWidth={1.75} />
        </div>
      </div>

      <p className="text-[12.5px] leading-relaxed text-ink-3">{def.description}</p>

      {/* Live mini KPIs */}
      <div className="grid grid-cols-4 gap-px overflow-hidden rounded-md border border-line bg-line">
        {def.fields.map((field, i) => {
          const v = resolveField(summary, field);
          return (
            <div key={field} className="flex flex-col gap-0.5 bg-paper px-2.5 py-2">
              <div className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3">
                {def.fieldLabels[i]}
              </div>
              <div className="font-mono text-[15px] font-semibold leading-none tabular-nums text-ink">
                {loading ? "—" : formatNum(v)}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div className="flex items-center justify-between border-t border-line pt-3 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3 transition-colors group-hover:text-accent">
        <span>open dashboard</span>
        <ArrowUpRight size={13} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </button>
  );
}

// ─── Custom dashboard row (editorial, no pastel) ────────────────────────────

function DashboardRow({
  d,
  onOpen,
  onEdit,
  onDelete,
  isDeleting,
  index,
}: {
  d: Dashboard;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  index: number;
}) {
  const id8 = d.id.slice(0, 8);
  return (
    <div
      style={{ animationDelay: `${index * 30}ms` }}
      className="reveal group grid cursor-pointer grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 border-b border-line/70 px-4 py-3 last:border-0 hover:bg-paper"
      onClick={onOpen}
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-line-strong bg-paper">
        {d.isPinned ? <Pin size={12} className="text-signal" /> : (
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-3">
            {id8.slice(0, 2)}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-ink">{d.name}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">id·{id8}</span>
        </div>
        {d.description && (
          <span className="truncate text-[12px] text-ink-3">{d.description}</span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Tag tone={visibilityTone(d.visibility)} size="sm">{d.visibility}</Tag>
        <span className="font-mono text-[11px] tabular-nums text-ink-3">
          {d.widgets.length}·widgets
        </span>
      </div>

      <span className="font-mono text-[11px] tabular-nums text-ink-3">
        v{d.version}
      </span>

      <div
        className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Edit dashboard"
          className="rounded p-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
          onClick={onEdit}
        >
          <Pencil size={13} />
        </button>
        <button
          type="button"
          aria-label="Delete dashboard"
          className="rounded p-1.5 text-ink-3 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
          onClick={onDelete}
          disabled={isDeleting}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [summary, setSummary] = useState<SummaryMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items } = await listDashboards({ limit: 100 });
      setDashboards(items);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    setLoadingSummary(true);
    getSummaryMetrics()
      .then(setSummary)
      .catch(() => null)
      .finally(() => setLoadingSummary(false));
  }, []);

  const pinned = dashboards.filter((d) => d.isPinned);
  const mine = dashboards.filter((d) => !d.isPinned);

  async function handleDelete(d: Dashboard) {
    setDeleting(d.id);
    try {
      await deleteDashboard(d.id, d.version);
      setDashboards((prev) => prev.filter((x) => x.id !== d.id));
    } catch {
      // silent
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="flex h-full flex-col gap-0">
      <Breadcrumb items={[{ label: "Reports & BI" }]} />
      <CommandBar
        actions={[
          {
            id: "new",
            label: "+ New Dashboard",
            icon: <Plus />,
            variant: "primary",
            onClick: () => router.push("/pm/reports/new"),
          },
        ]}
      />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[1400px] px-6 py-6 space-y-8">
          {/* ── Editorial intro ───────────────────────────────────────── */}
          <header className="reveal flex items-end justify-between gap-6 border-b border-line pb-5">
            <div className="flex flex-col gap-1.5">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
                ◢ control room · live tenant signals
              </div>
              <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-ink">
                Reports <span className="text-ink-3">&amp;</span> BI
              </h1>
            </div>
            <div className="hidden flex-col items-end gap-1 sm:flex">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">snapshot</div>
              <div className="font-mono text-[11px] tabular-nums text-ink-2">
                {new Date().toISOString().replace("T", " ").slice(0, 19)}Z
              </div>
            </div>
          </header>

          {/* ── Live instrument strip ─────────────────────────────────── */}
          <InstrumentStrip summary={summary} loading={loadingSummary} />

          {/* ── Pinned ───────────────────────────────────────────────── */}
          {pinned.length > 0 && (
            <section>
              <SectionHeader code="01" label="pinned" count={pinned.length} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pinned.map((d, i) => (
                  <PinnedCard
                    key={d.id}
                    d={d}
                    index={i}
                    onOpen={() => router.push(`/pm/reports/${d.id}`)}
                    onEdit={() => router.push(`/pm/reports/${d.id}/edit`)}
                    onDelete={() => handleDelete(d)}
                    isDeleting={deleting === d.id}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Prebuilt ─────────────────────────────────────────────── */}
          <section>
            <SectionHeader code={pinned.length > 0 ? "02" : "01"} label="prebuilt dashboards" count={PREBUILT.length} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PREBUILT.map((def, i) => (
                <PrebuiltCard
                  key={def.key}
                  def={def}
                  summary={summary}
                  loading={loadingSummary}
                  onOpen={() => router.push(`/pm/reports/${def.key}`)}
                  index={i}
                />
              ))}
            </div>
          </section>

          {/* ── My Dashboards ────────────────────────────────────────── */}
          <section>
            <div className="mb-3 flex items-end justify-between">
              <SectionHeader
                code={pinned.length > 0 ? "03" : "02"}
                label="custom dashboards"
                count={mine.length}
                inline
              />
              <Button size="sm" variant="secondary" onClick={() => router.push("/pm/reports/new")}>
                <Plus size={13} className="mr-1" /> New
              </Button>
            </div>

            {loading ? (
              <div className="space-y-1.5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-md bg-surface-2" />
                ))}
              </div>
            ) : mine.length === 0 ? (
              <div className="reveal rounded-lg border border-dashed border-line-strong bg-paper py-12 text-center">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
                  no custom dashboards yet
                </div>
                <button
                  type="button"
                  className="mt-3 inline-flex items-center gap-1 font-medium text-accent hover:text-accent-hover"
                  onClick={() => router.push("/pm/reports/new")}
                >
                  Compose your first one
                  <ArrowUpRight size={13} />
                </button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs">
                {mine.map((d, i) => (
                  <DashboardRow
                    key={d.id}
                    d={d}
                    index={i}
                    onOpen={() => router.push(`/pm/reports/${d.id}`)}
                    onEdit={() => router.push(`/pm/reports/${d.id}/edit`)}
                    onDelete={() => handleDelete(d)}
                    isDeleting={deleting === d.id}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Local keyframes */}
      <style jsx>{`
        :global(.reveal) {
          opacity: 0;
          transform: translateY(6px);
          animation: revealUp 480ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
        }
        @keyframes revealUp {
          to { opacity: 1; transform: translateY(0); }
        }
        :global(.animate-pulse-soft) {
          animation: pulseSoft 2.4s ease-in-out infinite;
        }
        @keyframes pulseSoft {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
    </div>
  );
}

// ─── Section header ─────────────────────────────────────────────────────────

function SectionHeader({
  code,
  label,
  count,
  inline,
}: {
  code: string;
  label: string;
  count: number;
  inline?: boolean;
}) {
  return (
    <h2 className={`flex items-baseline gap-3 ${inline ? "" : "mb-3"}`}>
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
        ◆ {code} / {label}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-ink-3">[{String(count).padStart(2, "0")}]</span>
    </h2>
  );
}

// ─── Pinned card (smaller, denser) ──────────────────────────────────────────

function PinnedCard({
  d, index, onOpen, onEdit, onDelete, isDeleting,
}: {
  d: Dashboard;
  index: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <div
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      style={{ animationDelay: `${100 + index * 60}ms` }}
      className="reveal group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-lg border border-line-strong bg-surface p-4 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-[3px] bg-signal"
      />
      <div className="flex items-start justify-between pl-2">
        <div>
          <div className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
            <Pin size={10} className="text-signal" /> pinned · id·{d.id.slice(0, 8)}
          </div>
          <div className="mt-0.5 font-semibold text-ink">{d.name}</div>
        </div>
        <Tag tone={visibilityTone(d.visibility)} size="sm">{d.visibility}</Tag>
      </div>
      {d.description && (
        <p className="pl-2 text-[12.5px] leading-relaxed text-ink-3 line-clamp-2">{d.description}</p>
      )}
      <div className="flex items-center justify-between border-t border-line pl-2 pt-2.5">
        <span className="font-mono text-[11px] tabular-nums text-ink-3">{d.widgets.length}·widgets · v{d.version}</span>
        <div
          className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Edit dashboard"
            className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
            onClick={onEdit}
          ><Pencil size={12} /></button>
          <button
            type="button"
            aria-label="Delete dashboard"
            className="rounded p-1 text-ink-3 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
            onClick={onDelete}
            disabled={isDeleting}
          ><Trash2 size={12} /></button>
        </div>
      </div>
    </div>
  );
}
