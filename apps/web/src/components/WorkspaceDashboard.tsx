"use client";

import { useMemo } from "react";
import { Plus } from "lucide-react";
import { Tag } from "@pmplatform/ui-kit";
import {
  type WorkspaceKind,
  type DocumentType,
  type DocumentStatus,
  type DocSummary,
  TYPES_BY_KIND,
} from "@/lib/api/documents";

// ─── Props ────────────────────────────────────────────────────────────────────

interface WorkspaceDashboardProps {
  kind: WorkspaceKind;
  docs: DocSummary[];
  allowedTypes: DocumentType[];
  onSelectDoc: (id: string) => void;
  onNewDoc: (type?: DocumentType) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const KIND_LABEL: Record<WorkspaceKind, string> = {
  ba: "BA Workspace",
  sa: "SA Workspace",
  pm: "PM Workspace",
  expert: "Expert Hub",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function statusTone(s: DocumentStatus): "success" | "warning" | "neutral" | "signal" {
  switch (s) {
    case "approved": return "success";
    case "review": return "warning";
    case "archived": return "signal";
    default: return "neutral";
  }
}

function typeLabel(t: DocumentType, kind: WorkspaceKind): string {
  return TYPES_BY_KIND[kind]?.find((x) => x.value === t)?.label ?? t;
}

// ─── WorkspaceDashboard ───────────────────────────────────────────────────────

export function WorkspaceDashboard({
  kind,
  docs,
  allowedTypes,
  onSelectDoc,
  onNewDoc,
}: WorkspaceDashboardProps) {
  // ── Aggregates ─────────────────────────────────────────────────────────────

  const byStatus = useMemo(() => {
    const counts: Record<DocumentStatus, number> = { draft: 0, review: 0, approved: 0, archived: 0 };
    for (const d of docs) counts[d.status] = (counts[d.status] ?? 0) + 1;
    return counts;
  }, [docs]);

  const byType = useMemo(() => {
    const counts: Record<string, { total: number; approved: number }> = {};
    for (const d of docs) {
      if (!counts[d.type]) counts[d.type] = { total: 0, approved: 0 };
      counts[d.type].total++;
      if (d.status === "approved") counts[d.type].approved++;
    }
    return counts;
  }, [docs]);

  const recentDocs = useMemo(
    () =>
      [...docs]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5),
    [docs],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-[1100px] space-y-6 px-6 py-6">

        {/* ── Editorial header ───────────────────────────────────────────── */}
        <header className="reveal-up flex items-end justify-between gap-6 border-b border-line pb-5">
          <div className="flex flex-col gap-1.5">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-ink-3">
              ◢ {KIND_LABEL[kind].toLowerCase()} · documents
            </div>
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
              {KIND_LABEL[kind]}
            </h1>
          </div>
          <div className="hidden flex-col items-end gap-1 sm:flex">
            <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">snapshot</div>
            <div className="font-mono text-[11px] tabular-nums text-ink-2">
              {docs.length} document{docs.length !== 1 ? "s" : ""}
            </div>
          </div>
        </header>

        {/* ── KPI strip ──────────────────────────────────────────────────── */}
        <section
          className="reveal-up relative overflow-hidden rounded-lg border border-line-strong bg-surface shadow-xs"
          aria-label="Document KPIs"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 blueprint-grid" />
          <div className="relative grid grid-cols-2 sm:grid-cols-5 divide-y divide-line sm:divide-y-0 sm:divide-x">
            {[
              { label: "total",     value: docs.length },
              { label: "draft",     value: byStatus.draft },
              { label: "in review", value: byStatus.review },
              { label: "approved",  value: byStatus.approved },
              { label: "archived",  value: byStatus.archived },
            ].map((k) => (
              <div key={k.label} className="flex flex-col gap-1 px-4 py-4">
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                  {k.label}
                </div>
                <div className="font-mono text-[22px] font-semibold leading-none tabular-nums text-ink">
                  {k.value}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Type breakdown ─────────────────────────────────────────────── */}
        <section className="reveal-up rounded-lg border border-line-strong bg-surface shadow-xs overflow-hidden">
          <div className="border-b border-line bg-paper px-4 py-2.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
              ◈ by type
            </span>
          </div>
          <div className="divide-y divide-line/60">
            {allowedTypes.map((t) => {
              const stat = byType[t] ?? { total: 0, approved: 0 };
              const pct = stat.total > 0 ? Math.round((stat.approved / stat.total) * 100) : 0;
              return (
                <div
                  key={t}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent-soft transition-colors"
                >
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-2 w-40 truncate">
                    {typeLabel(t, kind)}
                  </span>
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-xs bg-surface-2 px-1.5 font-mono text-[11px] font-semibold text-ink-2">
                    {stat.total}
                  </span>
                  <div className="ml-2 flex flex-1 items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full bg-success transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="font-mono text-[10px] tabular-nums text-ink-3 w-8 text-right">
                      {pct}%
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-ink-3">approved</span>
                </div>
              );
            })}
            {allowedTypes.length === 0 && (
              <div className="px-4 py-4 text-[12px] text-ink-3">No types configured.</div>
            )}
          </div>
        </section>

        {/* ── Recent documents ───────────────────────────────────────────── */}
        <section className="reveal-up rounded-lg border border-line-strong bg-surface shadow-xs overflow-hidden">
          <div className="border-b border-line bg-paper px-4 py-2.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
              ◈ recently updated
            </span>
          </div>
          {recentDocs.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[12px] text-ink-3">No documents yet. Create one below.</p>
            </div>
          ) : (
            <div className="divide-y divide-line/60">
              {recentDocs.map((doc) => (
                <button
                  type="button"
                  key={doc.id}
                  onClick={() => onSelectDoc(doc.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-accent-soft"
                >
                  <span className="flex-1 truncate text-[13px] font-medium text-ink">
                    {doc.title}
                  </span>
                  <Tag tone="neutral" size="sm">
                    {typeLabel(doc.type, kind)}
                  </Tag>
                  <Tag tone={statusTone(doc.status)} dot size="sm">
                    {doc.status}
                  </Tag>
                  <span className="font-mono text-[11px] tabular-nums text-ink-3 w-14 text-right">
                    {relativeTime(doc.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Quick create strip ──────────────────────────────────────────── */}
        <section className="reveal-up rounded-lg border border-line-strong bg-surface shadow-xs overflow-hidden">
          <div className="border-b border-line bg-paper px-4 py-2.5">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
              ◈ create new
            </span>
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-3">
            {allowedTypes.map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => onNewDoc(t)}
                className="inline-flex h-7 items-center gap-1.5 rounded-xs border border-line-strong bg-paper px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2 transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-ink"
              >
                <Plus size={11} />
                {typeLabel(t, kind)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onNewDoc()}
              className="inline-flex h-7 items-center gap-1.5 rounded-xs border border-accent/40 bg-accent-soft px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-accent transition-colors hover:bg-accent hover:text-surface"
            >
              <Plus size={11} />
              Any Type
            </button>
          </div>
        </section>

      </div>
    </div>
  );
}
