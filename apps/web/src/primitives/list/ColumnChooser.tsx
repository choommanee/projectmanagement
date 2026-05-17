"use client";
import type { ColumnDef } from "./list.types";

export function ColumnChooser({ columns, onChange }:
  { columns: ColumnDef[]; onChange: (cols: ColumnDef[]) => void }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer rounded-md px-2 py-1 text-sm hover:bg-bgMuted">Columns</summary>
      <div className="absolute right-0 z-50 mt-1 min-w-56 rounded-md border border-border bg-bg p-2 shadow-md">
        {columns.map((c) => (
          <label key={c.name} className="flex items-center gap-2 px-1 py-0.5 text-sm">
            <input
              type="checkbox"
              defaultChecked={!c.hidden}
              onChange={(e) => onChange(columns.map((x) => x.name === c.name ? { ...x, hidden: !e.target.checked } : x))}
            />
            {c.label}
          </label>
        ))}
      </div>
    </details>
  );
}
