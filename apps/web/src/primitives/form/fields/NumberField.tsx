import { Input } from "@pmplatform/ui-kit";
import type { FieldDef } from "../form.types";

export function NumberField({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: number | null) => void; readOnly?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-fgMuted">{def.label}{def.required ? " *" : ""}</span>
      <Input
        type="number"
        defaultValue={typeof value === "number" ? value : ""}
        disabled={readOnly}
        onBlur={(e) => {
          const v = (e.target as HTMLInputElement).value;
          onChange(v === "" ? null : Number(v));
        }}
      />
    </label>
  );
}
