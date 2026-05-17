import type { FieldDef } from "../form.types";

export function BooleanField({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: boolean) => void; readOnly?: boolean }) {
  const checked = !!value;
  return (
    <label className="flex items-center gap-3 text-sm">
      <button
        type="button"
        role="switch"
        aria-checked={checked ? "true" : "false"}
        aria-label={def.label}
        title={def.label}
        disabled={readOnly}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-accent" : "bg-line-strong"}`}
      >
        <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-xs transition-transform ${checked ? "translate-x-3.5" : "translate-x-0.5"}`} />
      </button>
      <span className="text-ink-2">{def.label}{def.required ? " *" : ""}</span>
    </label>
  );
}
