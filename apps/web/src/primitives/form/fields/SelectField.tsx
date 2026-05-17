import type { FieldDef } from "../form.types";

export function SelectField({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: string) => void; readOnly?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs text-fgMuted">{def.label}{def.required ? " *" : ""}</span>
      <select
        className="h-8 w-full rounded-md border border-border bg-bg px-2 text-sm"
        defaultValue={typeof value === "string" ? value : ""}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {def.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
