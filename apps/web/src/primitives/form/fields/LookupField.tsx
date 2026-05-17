import { Input } from "@pmplatform/ui-kit";
import type { FieldDef } from "../form.types";

export function LookupField({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: string) => void; readOnly?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-fgMuted">{def.label}{def.required ? " *" : ""}</span>
      <Input
        defaultValue={typeof value === "string" ? value : ""}
        disabled={readOnly}
        placeholder={`Lookup ${def.lookup?.entity ?? ""}`}
        onBlur={(e) => onChange((e.target as HTMLInputElement).value)}
      />
    </label>
  );
}
