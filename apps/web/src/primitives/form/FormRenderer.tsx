"use client";
import { useMemo, useState } from "react";
import { Tag } from "@pmplatform/ui-kit";
import type { FormDef, FieldDef } from "./form.types";
import { evaluateRules } from "./rules";
import { TextField } from "./fields/TextField";
import { NumberField } from "./fields/NumberField";
import { SelectField } from "./fields/SelectField";
import { DateField } from "./fields/DateField";
import { BooleanField } from "./fields/BooleanField";
import { LookupField } from "./fields/LookupField";
import { statusTone } from "@/primitives/list/cells";

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
    <div className="flex flex-col gap-4">
      {def.header && (
        <div className="rounded-md border border-line bg-surface p-4 shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-3">{def.entity}</div>
              <h2 className="mt-1 text-xl font-semibold text-ink">{String(value[def.header.titleField] ?? "—")}</h2>
            </div>
            {def.header.statusField && (() => {
              const sv = value[def.header.statusField];
              if (!sv) return null;
              return (
                <Tag tone={statusTone(sv)} dot>
                  {String(sv)}
                </Tag>
              );
            })()}
          </div>
        </div>
      )}

      {def.tabs.length > 1 && (
        <div role="tablist" className="flex gap-1 border-b border-line">
          {def.tabs.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active ? "true" : "false"}
                className={`relative px-3 py-2 text-sm transition-colors ${active ? "text-ink font-medium" : "text-ink-3 hover:text-ink-2"}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-t-sm" />}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-5">
        {active?.sections.map((s) => (
          <section key={s.id}>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3 mb-3">{s.label}</h3>
            <div className={`grid gap-x-6 gap-y-4 ${s.columns === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
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
