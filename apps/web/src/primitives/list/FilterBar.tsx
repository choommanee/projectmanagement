"use client";
import { useState } from "react";
import type { FilterClause } from "./list.types";

export function FilterBar({ onApply }: { onApply: (f?: FilterClause) => void }) {
  const [field, setField] = useState("");
  const [op, setOp]       = useState<FilterClause["op"]>("eq");
  const [value, setValue] = useState("");
  return (
    <div className="flex items-center gap-1 text-sm">
      <input className="h-7 rounded-md border border-border bg-bg px-2" placeholder="field" value={field} onChange={(e) => setField(e.target.value)} />
      <select className="h-7 rounded-md border border-border bg-bg px-1" value={op} onChange={(e) => setOp(e.target.value as FilterClause["op"])}>
        <option value="eq">=</option><option value="neq">≠</option>
        <option value="contains">∋</option>
        <option value="gt">&gt;</option><option value="lt">&lt;</option>
      </select>
      <input className="h-7 rounded-md border border-border bg-bg px-2" placeholder="value" value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="rounded-md bg-primary px-2 py-0.5 text-white" onClick={() => onApply(field ? { field, op, value } : undefined)}>Apply</button>
      <button className="text-fgMuted" onClick={() => onApply(undefined)}>Clear</button>
    </div>
  );
}
