import { Input } from "@pmplatform/ui-kit";
import type { FieldDef } from "../form.types";

export function NumberField({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: number | null) => void; readOnly?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
        {def.label}{def.required ? " *" : ""}
      </span>
      <Input
        type="number"
        className="font-mono tabular-nums"
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
