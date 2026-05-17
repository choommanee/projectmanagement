"use client";
import { useMemo, useState } from "react";
import type { FormDef, FieldDef } from "./form.types";
import { evaluateRules } from "./rules";
import { TextField } from "./fields/TextField";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import { DateField } from "./fields/DateField";
import { BooleanField } from "./fields/BooleanField";
import { LookupField } from "./fields/LookupField";

export interface FormRendererProps {
  def: FormDef;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function FormRenderer({ def, value, onChange }: FormRendererProps) {
  const [tab, setTab] = useState(def.tabs[0]?.id);
  const overrides = useMemo(() => evaluateRules(def.rules, value), [def.rules, value]);

  const set = (name: string, v: unknown) => onChange({ ...value, [name]: v });

  const active = def.tabs.find((t) => t.id === tab) ?? def.tabs[0];

  return (
    <div className="flex flex-col gap-3">
      {def.header && (
        <div className="rounded-md border border-border bg-bgMuted p-3">
          <div className="text-base font-medium">{String(value[def.header.titleField] ?? "—")}</div>
          {def.header.statusField && <div className="text-xs text-fgMuted">{String(value[def.header.statusField] ?? "")}</div>}
        </div>
      )}

      {def.tabs.length > 1 && (
        <div role="tablist" className="flex border-b border-border">
          {def.tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`px-3 py-1.5 text-sm ${tab === t.id ? "border-b-2 border-primary font-medium" : "text-fgMuted"}`}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </div>
      )}

      <div className="space-y-4">
        {active?.sections.map((s) => (
          <section key={s.id}>
            <h3 className="mb-2 text-xs font-semibold uppercase text-fgMuted">{s.label}</h3>
            <div className={`grid gap-3 ${s.columns === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {s.fields.map((f) => {
                const ov = overrides[f.name] ?? {};
                if (ov.hidden || f.hidden) return null;
                const ro = ov.readOnly ?? f.readOnly ?? false;
                return <FieldSwitch key={f.name} def={{ ...f, required: ov.required ?? f.required }} value={value[f.name]} readOnly={ro} onChange={(v) => set(f.name, v)} />;
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function FieldSwitch({ def, value, onChange, readOnly }:
  { def: FieldDef; value: unknown; onChange: (v: unknown) => void; readOnly?: boolean }) {
  switch (def.kind) {
    case "text":    return <TextField    def={def} value={value} readOnly={readOnly} onChange={onChange as (v: string) => void} />;
    case "number":  return <NumberField  def={def} value={value} readOnly={readOnly} onChange={onChange as (v: number | null) => void} />;
    case "select":  return <SelectField  def={def} value={value} readOnly={readOnly} onChange={onChange as (v: string) => void} />;
    case "date":    return <DateField    def={def} value={value} readOnly={readOnly} onChange={onChange as (v: string) => void} />;
    case "boolean": return <BooleanField def={def} value={value} readOnly={readOnly} onChange={onChange as (v: boolean) => void} />;
    case "lookup":  return <LookupField  def={def} value={value} readOnly={readOnly} onChange={onChange as (v: string) => void} />;
  }
}
