import { Input } from "@pmplatform/ui-kit";
import type { FieldDef } from "../form.types";

export function DateField({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: string) => void; readOnly?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {def.label}{def.required ? " *" : ""}
      </span>
      <Input
        type="date"
        defaultValue={typeof value === "string" ? value : ""}
        disabled={readOnly}
        onBlur={(e) => onChange((e.target as HTMLInputElement).value)}
      />
    </label>
  );
}
