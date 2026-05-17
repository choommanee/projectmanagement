import { ChevronDown } from "lucide-react";
import type { FieldDef } from "../form.types";

export function SelectField({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: string) => void; readOnly?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {def.label}{def.required ? " *" : ""}
      </span>
      <div className="relative">
        <select
          className="h-9 w-full appearance-none rounded-sm border border-line bg-surface px-3 pr-8 text-sm text-ink hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 disabled:bg-surface-2 disabled:text-ink-3"
          defaultValue={typeof value === "string" ? value : ""}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {def.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
      </div>
    </label>
  );
}
