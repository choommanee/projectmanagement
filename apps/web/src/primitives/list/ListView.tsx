"use client";
import { useMemo, useRef, useState } from "react";
import {
  flexRender, getCoreRowModel, useReactTable, type ColumnDef as TanColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ListDef, ViewDef } from "./list.types";
import { applyFilter } from "./filter";
import { ViewSelector } from "./ViewSelector";

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

  const columns = useMemo<TanColumnDef<Record<string, unknown>>[]>(() => view.columns.filter((c) => !c.hidden).map((c) => ({
    accessorKey: c.name,
    header: c.label,
    cell: (info) => String(info.getValue() ?? ""),
    size: c.width ?? 160,
  })), [view.columns]);

  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel() });

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 10,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const tableRows = table.getRowModel().rows;

  // In jsdom, virtualizer may return 0 virtual items when container has no size.
  // Fall back to rendering all rows directly so tests can assert cell content.
  const renderAllRows = virtualItems.length === 0 && tableRows.length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <ViewSelector views={def.views} value={view.id} onChange={setViewId} />
        <span className="text-xs text-fgMuted">{data.length} records</span>
      </div>
      <div ref={parentRef} className="flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-10 bg-bg">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} style={{ width: h.getSize() }} className="border-b border-border px-2 py-1 text-left text-xs font-semibold text-fgMuted">
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
                  className="cursor-pointer hover:bg-bgMuted"
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} style={{ width: cell.column.getSize() }} className="border-b border-border px-2 py-1">
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
                    className="absolute left-0 right-0 cursor-pointer hover:bg-bgMuted"
                    style={{ transform: `translateY(${vRow.start}px)` }}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} style={{ width: cell.column.getSize() }} className="border-b border-border px-2 py-1">
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
