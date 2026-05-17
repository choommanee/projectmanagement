import { Search } from "lucide-react";
import { Input } from "@pmplatform/ui-kit";
import type { FieldDef } from "../form.types";

export function LookupField({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: string) => void; readOnly?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {def.label}{def.required ? " *" : ""}
      </span>
      <div className="relative">
        <Input
          defaultValue={typeof value === "string" ? value : ""}
          disabled={readOnly}
          placeholder={`Lookup ${def.lookup?.entity ?? ""}`}
          className="pr-8"
          onBlur={(e) => onChange((e.target as HTMLInputElement).value)}
        />
        <Search size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
      </div>
    </label>
  );
}
