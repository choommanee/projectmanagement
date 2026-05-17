import { Input } from "@pmplatform/ui-kit";
import type { FieldDef } from "../form.types";

export function DateField({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: string) => void; readOnly?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-fgMuted">{def.label}{def.required ? " *" : ""}</span>
      <Input type="date" defaultValue={typeof value === "string" ? value : ""} disabled={readOnly} onBlur={(e) => onChange((e.target as HTMLInputElement).value)} />
    </label>
  );
}
