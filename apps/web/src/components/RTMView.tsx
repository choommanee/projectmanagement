"use client";

import { useCallback, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Tag } from "@pmplatform/ui-kit";
import type { Document } from "@/lib/api/documents";

// ─── Types ────────────────────────────────────────────────────────────────────

type RTMRow = {
  id: string;
  reqId: string;
  description: string;
  userStory: string;
  testRef: string;
  status: "covered" | "partial" | "not_covered";
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface RTMViewProps {
  doc: Document;
  onMetadataChange: (metadata: Record<string, unknown>) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function coverageTone(s: RTMRow["status"]): "success" | "warning" | "signal" {
  if (s === "covered") return "success";
  if (s === "partial") return "warning";
  return "signal";
}

const COVERAGE_LABEL: Record<RTMRow["status"], string> = {
  covered: "Covered",
  partial: "Partial",
  not_covered: "Not Covered",
};

// ─── RTMView ──────────────────────────────────────────────────────────────────

export function RTMView({ doc, onMetadataChange }: RTMViewProps) {
  const [rows, setRows] = useState<RTMRow[]>(
    () => (doc.metadata?.rows as RTMRow[] | undefined) ?? [],
  );

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Debounced propagation ──────────────────────────────────────────────────

  const scheduleUpdate = useCallback(
    (updatedRows: RTMRow[]) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        onMetadataChange({ ...doc.metadata, rows: updatedRows });
      }, 800);
    },
    [doc.metadata, onMetadataChange],
  );

  // ── Row mutations ──────────────────────────────────────────────────────────

  function updateRow(id: string, patch: Partial<RTMRow>) {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      scheduleUpdate(next);
      return next;
    });
  }

  function addRow() {
    setRows((prev) => {
      const next: RTMRow[] = [
        ...prev,
        {
          id: crypto.randomUUID(),
          reqId: `REQ-${String(prev.length + 1).padStart(3, "0")}`,
          description: "",
          userStory: "",
          testRef: "",
          status: "not_covered",
        },
      ];
      scheduleUpdate(next);
      return next;
    });
  }

  function deleteRow(id: string) {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      scheduleUpdate(next);
      return next;
    });
  }

  // ── Coverage summary ───────────────────────────────────────────────────────

  const covered = rows.filter((r) => r.status === "covered").length;
  const total = rows.length;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line bg-paper px-4 py-2.5">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
          ◢ requirements traceability matrix
        </div>
        <div className="font-mono text-[11px] tabular-nums text-ink-3">
          {doc.title}
        </div>
      </div>

      {/* Table — scrollable */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-paper">
            <tr>
              {["REQ ID", "Description", "User Story", "Test Ref", "Coverage", ""].map((h) => (
                <th
                  key={h}
                  className="border-b border-line px-3 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <p className="text-[12px] text-ink-3">
                    No requirements yet. Add one below.
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-line/60 transition-colors hover:bg-accent-soft/40"
                >
                  {/* REQ ID */}
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <input
                      type="text"
                      aria-label="Requirement ID"
                      value={row.reqId}
                      onChange={(e) => updateRow(row.id, { reqId: e.target.value })}
                      className="h-7 w-24 rounded-xs border border-transparent bg-transparent px-1.5 font-mono text-[12px] text-ink focus:border-accent focus:bg-surface focus:outline-none"
                    />
                  </td>

                  {/* Description */}
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      aria-label="Description"
                      value={row.description}
                      onChange={(e) => updateRow(row.id, { description: e.target.value })}
                      placeholder="Requirement description…"
                      className="h-7 w-full min-w-40 rounded-xs border border-transparent bg-transparent px-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:bg-surface focus:outline-none"
                    />
                  </td>

                  {/* User Story */}
                  <td className="px-2 py-1.5">
                    <input
                      type="text"
                      aria-label="User story"
                      value={row.userStory}
                      onChange={(e) => updateRow(row.id, { userStory: e.target.value })}
                      placeholder="As a user…"
                      className="h-7 w-full min-w-40 rounded-xs border border-transparent bg-transparent px-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:bg-surface focus:outline-none"
                    />
                  </td>

                  {/* Test Ref */}
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <input
                      type="text"
                      aria-label="Test reference"
                      value={row.testRef}
                      onChange={(e) => updateRow(row.id, { testRef: e.target.value })}
                      placeholder="TC-000"
                      className="h-7 w-20 rounded-xs border border-transparent bg-transparent px-1.5 font-mono text-[12px] text-ink placeholder:text-ink-3 focus:border-accent focus:bg-surface focus:outline-none"
                    />
                  </td>

                  {/* Coverage */}
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <select
                        aria-label="Coverage status"
                        value={row.status}
                        onChange={(e) =>
                          updateRow(row.id, { status: e.target.value as RTMRow["status"] })
                        }
                        className="h-7 appearance-none rounded-xs border border-line bg-surface px-2 text-[12px] text-ink focus:border-accent focus:outline-none"
                      >
                        <option value="covered">Covered</option>
                        <option value="partial">Partial</option>
                        <option value="not_covered">Not Covered</option>
                      </select>
                      <Tag tone={coverageTone(row.status)} dot size="sm">
                        {COVERAGE_LABEL[row.status]}
                      </Tag>
                    </div>
                  </td>

                  {/* Delete */}
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      aria-label="Delete row"
                      onClick={() => deleteRow(row.id)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-xs text-ink-3 transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer bar */}
      <div className="flex items-center justify-between border-t border-line bg-paper px-4 py-2">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex h-7 items-center gap-1.5 rounded-xs border border-line-strong bg-surface px-3 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2 transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-ink"
        >
          <Plus size={12} />
          Add Requirement
        </button>

        <div className="font-mono text-[11px] tabular-nums text-ink-3">
          {covered} of {total} covered
          {total > 0 && (
            <span className="ml-1 text-ink-2">({pct}%)</span>
          )}
        </div>
      </div>
    </div>
  );
}
