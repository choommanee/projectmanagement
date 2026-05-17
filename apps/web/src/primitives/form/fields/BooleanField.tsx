import type { FieldDef } from "../form.types";

export function BooleanField({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: boolean) => void; readOnly?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={!!value} disabled={readOnly} onChange={(e) => onChange(e.target.checked)} />
      <span>{def.label}{def.required ? " *" : ""}</span>
    </label>
  );
}
