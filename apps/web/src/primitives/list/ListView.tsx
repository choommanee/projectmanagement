"use client";
import { useMemo, useRef, useState } from "react";
import {
  flexRender, getCoreRowModel, useReactTable, type ColumnDef as TanColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Filter, Columns3 } from "lucide-react";
import { Tag } from "@pmplatform/ui-kit";
import { Button } from "@pmplatform/ui-kit";
import type { ListDef, ViewDef } from "./list.types";
import { applyFilter } from "./filter";
import { ViewSelector } from "./ViewSelector";
import { statusTone, looksMono } from "./cells";

export interface ListViewProps {
  def: ListDef;
  rows: Record<string, unknown>[];
  initialViewId?: string;
  onRowClick?: (row: Record<string, unknown>) => void;
}

export function ListView({ def, rows, initialViewId, onRowClick }: ListViewProps) {
  const [viewId, setViewId] = useState(initialViewId ?? def.views[0]?.id);
  const view = (def.views.find((v) => v.id === viewId) ?? def.views[0]) as ViewDef;

  const data = useMemo(() => applyFilter(rows, view.filter), [rows, view.filter]);

  const kindByKey = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const c of view.columns) m.set(c.name, c.kind);
    return m;
  }, [view.columns]);

  const columns = useMemo<TanColumnDef<Record<string, unknown>>[]>(() =>
    view.columns.filter((c) => !c.hidden).map((c) => ({
      accessorKey: c.name,
      header: c.label,
      size: c.width ?? 160,
      cell: (info) => {
        const key = info.column.id;
        const value = info.getValue();
        const kind = kindByKey.get(key);
        if (kind === "status") {
          return (
            <Tag tone={statusTone(value)} dot>
              {String(value ?? "")}
            </Tag>
          );
        }
        if (kind === "number") {
          return (
            <span className="font-mono tabular-nums">{String(value ?? "")}</span>
          );
        }
        if (looksMono(value)) {
          return (
            <span className="font-mono text-[12px]">{String(value ?? "")}</span>
          );
        }
        return String(value ?? "");
      },
    })),
    [view.columns, kindByKey],
  );

  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const tableRows = table.getRowModel().rows;

  // In jsdom, virtualizer may return 0 virtual items when container has no size.
  // Fall back to rendering all rows directly so tests can assert cell content.
  const renderAllRows = virtualItems.length === 0 && tableRows.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 bg-paper px-3 py-2 border-b border-line">
        <ViewSelector views={def.views} value={view.id} onChange={setViewId} />
        <Button variant="ghost" size="sm">
          <Filter size={14} />
        </Button>
        <Button variant="ghost" size="sm">
          <Columns3 size={14} />
        </Button>
        <span className="ml-auto font-mono tabular-nums text-[12px] text-ink-3">
          {data.length} records
        </span>
      </div>

      {/* Table */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-surface-2">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={{ width: h.getSize() }}
                    className="text-left text-[11px] uppercase tracking-wider text-ink-3 font-semibold py-2 px-3 border-b border-line"
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          {renderAllRows ? (
            <tbody>
              {tableRows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-line/60 hover:bg-accent-soft even:bg-surface/40 transition-colors duration-100 cursor-pointer"
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="py-2 px-3 text-[13px] text-ink align-middle border-b border-line/60"
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ) : (
            <tbody style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
              {virtualItems.map((vRow) => {
                const row = tableRows[vRow.index];
                return (
                  <tr
                    key={row.id}
                    className="absolute left-0 right-0 border-b border-line/60 hover:bg-accent-soft transition-colors duration-100 cursor-pointer"
                    style={{ transform: `translateY(${vRow.start}px)` }}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                        className="py-2 px-3 text-[13px] text-ink align-middle border-b border-line/60"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}
