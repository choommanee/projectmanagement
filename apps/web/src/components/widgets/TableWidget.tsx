"use client";

export interface TableWidgetProps {
  title: string;
  columns: string[];
  rows: (string | number)[][];
  loading?: boolean;
}

export function TableWidget({ title, columns, rows, loading }: TableWidgetProps) {
  return (
    <div className="flex flex-col rounded-sm border border-line bg-surface overflow-hidden">
      {/* Header bar */}
      <div className="border-b border-line bg-surface-2 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-3">{title}</span>
      </div>

      {loading ? (
        <div className="space-y-px p-0">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-9 animate-pulse border-b border-line bg-surface-2" />
          ))}
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-2 text-left text-xs font-medium text-ink-3">
                {columns.map((col, i) => (
                  <th key={i} className="px-4 py-2 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length || 1}
                    className="px-4 py-6 text-center text-xs text-ink-3"
                  >
                    No data
                  </td>
                </tr>
              ) : (
                rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-line hover:bg-surface-2">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={`px-4 py-2 text-xs ${
                          typeof cell === "number"
                            ? "font-mono tabular-nums text-ink"
                            : "text-ink-2"
                        }`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
