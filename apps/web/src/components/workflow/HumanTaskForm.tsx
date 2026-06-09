"use client";

import { useMemo, useState } from "react";
import { Button, Input, Select, TextArea } from "@pmplatform/ui-kit";
import {
  parseHumanForm,
  type HumanFormField,
  type HumanTask,
} from "@/lib/api/workflows";

// ─── Default outcomes when the author declared none ──────────────────────────

const DEFAULT_OUTCOMES = ["approved", "rejected"];

function outcomeLabel(o: string): string {
  return o
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function outcomeVariant(o: string): "primary" | "danger" | "secondary" {
  const k = o.toLowerCase();
  if (k.includes("reject") || k.includes("deny") || k.includes("decline")) return "danger";
  if (k.includes("approv") || k.includes("accept") || k.includes("confirm")) return "primary";
  return "secondary";
}

// ─── Field renderer ──────────────────────────────────────────────────────────

function FieldControl({
  field,
  value,
  invalid,
  onChange,
}: {
  field: HumanFormField;
  value: unknown;
  invalid: boolean;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case "textarea":
      return (
        <TextArea
          rows={3}
          value={value == null ? "" : String(value)}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid || undefined}
        />
      );
    case "number":
      return (
        <Input
          type="number"
          size="sm"
          value={value == null ? "" : String(value)}
          placeholder={field.placeholder}
          invalid={invalid}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        />
      );
    case "date":
      return (
        <Input
          type="date"
          size="sm"
          value={value == null ? "" : String(value)}
          invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
            className="h-3.5 w-3.5 rounded-sm border-line text-accent focus:ring-accent/30"
          />
          <span className="text-ink-2">{field.placeholder ?? "Yes"}</span>
        </label>
      );
    case "select":
      return (
        <Select
          size="sm"
          value={value == null ? "" : String(value)}
          placeholder={field.placeholder ?? "Select…"}
          invalid={invalid}
          options={field.options}
          onChange={(v) => onChange(v)}
        />
      );
    case "text":
    default:
      return (
        <Input
          size="sm"
          value={value == null ? "" : String(value)}
          placeholder={field.placeholder}
          invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

// ─── Form ────────────────────────────────────────────────────────────────────

export interface HumanTaskFormProps {
  task: HumanTask;
  submitting?: boolean;
  /** Outer error (e.g. API failure) surfaced above the buttons. */
  error?: string | null;
  onSubmit: (outcome: string, data: Record<string, unknown>) => void;
}

/**
 * Schema-driven renderer for a human task `form` blob.
 * - Parses `form.fields[]` → typed inputs (text/textarea/number/select/checkbox/date).
 * - Derives outcome buttons from `form.outcomes` (falls back to Approve/Reject).
 * - Falls back to a raw JSON editor when the blob isn't a usable schema.
 */
export function HumanTaskForm({ task, submitting, error, onSubmit }: HumanTaskFormProps) {
  const schema = useMemo(() => parseHumanForm(task.form), [task.form]);

  // ── Schema-driven path ──
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [touched, setTouched] = useState(false);

  // ── Raw JSON fallback path ──
  const [rawJson, setRawJson] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const outcomes = schema && schema.outcomes.length > 0 ? schema.outcomes : DEFAULT_OUTCOMES;

  const missingRequired = useMemo(() => {
    if (!schema) return [] as string[];
    return schema.fields
      .filter((f) => f.required)
      .filter((f) => {
        const v = values[f.name];
        if (f.type === "checkbox") return v !== true;
        return v == null || v === "";
      })
      .map((f) => f.name);
  }, [schema, values]);

  const setField = (name: string, v: unknown) =>
    setValues((prev) => ({ ...prev, [name]: v }));

  const submit = (outcome: string) => {
    if (schema) {
      setTouched(true);
      if (missingRequired.length > 0) return;
      onSubmit(outcome, values);
      return;
    }
    // raw fallback
    let data: Record<string, unknown> = {};
    if (rawJson.trim()) {
      try {
        const parsed = JSON.parse(rawJson);
        data = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
      } catch {
        setJsonError("Invalid JSON in response data");
        return;
      }
    }
    setJsonError(null);
    onSubmit(outcome, data);
  };

  return (
    <div className="space-y-3">
      {schema?.prompt && (
        <p className="text-sm leading-relaxed text-ink">{schema.prompt}</p>
      )}

      {schema ? (
        schema.fields.length > 0 && (
          <div className="space-y-3">
            {schema.fields.map((f) => {
              const invalid = touched && missingRequired.includes(f.name);
              return (
                <div key={f.name} className="space-y-1">
                  {f.type !== "checkbox" && (
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-ink-3">
                      {f.label}
                      {f.required && <span className="ml-0.5 text-danger">*</span>}
                    </label>
                  )}
                  <FieldControl
                    field={f}
                    value={values[f.name]}
                    invalid={invalid}
                    onChange={(v) => setField(f.name, v)}
                  />
                  {invalid && (
                    <p className="text-[11px] text-danger">This field is required.</p>
                  )}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-ink-3">
            Response data (JSON, optional)
          </label>
          <TextArea
            rows={4}
            value={rawJson}
            onChange={(e) => {
              setRawJson(e.target.value);
              setJsonError(null);
            }}
            className="font-mono text-[11px]"
            placeholder='{"comment": "looks good"}'
          />
          {jsonError && <p className="mt-0.5 text-[11px] text-danger">{jsonError}</p>}
        </div>
      )}

      {error && (
        <p className="rounded-sm border border-danger/30 bg-danger/5 px-2 py-1 text-[11px] text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        {outcomes.map((o) => (
          <Button
            key={o}
            size="sm"
            variant={outcomeVariant(o)}
            disabled={submitting}
            onClick={() => submit(o)}
          >
            {submitting ? "Submitting…" : outcomeLabel(o)}
          </Button>
        ))}
      </div>
    </div>
  );
}
