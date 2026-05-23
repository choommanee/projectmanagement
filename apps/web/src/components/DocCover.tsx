"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Document, DocumentType } from "@/lib/api/documents";

// ─── Sub-components ───────────────────────────────────────────────────────────

function TagList({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft("");
  }

  function remove(idx: number) {
    onChange(values.filter((_, i) => i !== idx));
  }

  return (
    <div className="inline-flex flex-wrap gap-1 items-center min-h-7 rounded-xs border border-line bg-surface px-1.5 py-1">
      {values.map((v, i) => (
        <span
          key={i}
          className="inline-flex items-center gap-0.5 rounded-xs bg-surface-2 border border-line px-1.5 py-0.5 text-[11px] text-ink"
        >
          {v}
          <button
            type="button"
            onClick={() => remove(i)}
            className="ml-0.5 text-ink-3 hover:text-ink leading-none"
          >
            ×
          </button>
        </span>
      ))}
      <div className="flex items-center gap-0.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={values.length === 0 ? placeholder : ""}
          className="border-0 bg-transparent text-[12px] text-ink focus:outline-none w-24 min-w-0"
        />
        <button
          type="button"
          onClick={add}
          className="text-[11px] text-ink-3 hover:text-accent leading-none px-0.5"
        >
          +
        </button>
      </div>
    </div>
  );
}

// ─── Acceptance Criteria Table ────────────────────────────────────────────────

type ACRow = { id: string; given: string; when: string; then: string };

function AcceptanceCriteriaTable({
  rows,
  onChange,
}: {
  rows: ACRow[];
  onChange: (r: ACRow[]) => void;
}) {
  function update(id: string, field: keyof ACRow, value: string) {
    onChange(rows.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  function remove(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }

  function addRow() {
    onChange([
      ...rows,
      { id: crypto.randomUUID(), given: "", when: "", then: "" },
    ]);
  }

  return (
    <div className="flex flex-col gap-1">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line">
            <th className="py-1 px-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3 w-6">
              #
            </th>
            <th className="py-1 px-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">
              Given
            </th>
            <th className="py-1 px-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">
              When
            </th>
            <th className="py-1 px-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">
              Then
            </th>
            <th className="w-5" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={row.id} className="border-b border-line/40">
              <td className="py-0.5 px-1 text-ink-3 font-mono text-[11px]">
                {idx + 1}
              </td>
              {(["given", "when", "then"] as const).map((field) => (
                <td key={field} className="py-0.5 px-0.5">
                  <input
                    value={row[field]}
                    onChange={(e) => update(row.id, field, e.target.value)}
                    className="border-0 bg-transparent w-full text-[12px] px-1 focus:outline-none text-ink"
                  />
                </td>
              ))}
              <td className="py-0.5 px-1">
                <button
                  type="button"
                  onClick={() => remove(row.id)}
                  className="text-ink-3 hover:text-ink leading-none text-[11px]"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={addRow}
        className="self-start text-[11px] font-mono text-ink-3 hover:text-accent"
      >
        + Add Scenario
      </button>
    </div>
  );
}

// ─── Tech Stack Table ─────────────────────────────────────────────────────────

const LAYERS = [
  "Frontend",
  "Backend",
  "Database",
  "Cache",
  "Queue",
  "Storage",
  "Deploy",
];

type TechLayerMap = Record<string, { tech: string; notes: string }>;

function TechStackTable({
  layers,
  onChange,
}: {
  layers: TechLayerMap;
  onChange: (l: TechLayerMap) => void;
}) {
  function update(layer: string, field: "tech" | "notes", value: string) {
    const current = layers[layer] ?? { tech: "", notes: "" };
    onChange({ ...layers, [layer]: { ...current, [field]: value } });
  }

  return (
    <table className="w-full border-collapse text-[12px]">
      <thead>
        <tr className="border-b border-line">
          <th className="py-1 px-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3 w-24">
            Layer
          </th>
          <th className="py-1 px-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">
            Technology
          </th>
          <th className="py-1 px-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3">
            Notes
          </th>
        </tr>
      </thead>
      <tbody>
        {LAYERS.map((layer) => {
          const row = layers[layer] ?? { tech: "", notes: "" };
          return (
            <tr key={layer} className="border-b border-line/40">
              <td className="py-0.5 px-1 text-ink-3 font-mono text-[11px]">
                {layer}
              </td>
              <td className="py-0.5 px-0.5">
                <input
                  value={row.tech}
                  onChange={(e) => update(layer, "tech", e.target.value)}
                  className="border-0 bg-transparent w-full text-[12px] px-1 focus:outline-none text-ink"
                />
              </td>
              <td className="py-0.5 px-0.5">
                <input
                  value={row.notes}
                  onChange={(e) => update(layer, "notes", e.target.value)}
                  className="border-0 bg-transparent w-full text-[12px] px-1 focus:outline-none text-ink"
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Type label helper ────────────────────────────────────────────────────────

const TYPE_LABELS: Partial<Record<DocumentType, string>> = {
  brd: "Business Requirements Document",
  frd: "Functional Requirements Document",
  user_story: "User Story",
  use_case: "Use Case",
  process_flow: "Process Flow",
  sdd: "Software Design Document",
  adr: "Architecture Decision Record",
  er_diagram: "ER Diagram",
  sequence_diagram: "Sequence Diagram",
  api_spec: "API Specification",
  tech_stack: "Tech Stack Decision",
  knowledge_article: "Knowledge Article",
  decision_log: "Decision Log",
  qa: "Q&A",
  lesson_learned: "Lesson Learned",
  expertise_profile: "Expertise Profile",
};

function typeLabel(t: DocumentType): string {
  return TYPE_LABELS[t] ?? t;
}

// ─── Shared input class constants ─────────────────────────────────────────────

const CLS_TEXTAREA =
  "h-16 resize-none rounded-xs border border-line bg-surface px-2 py-1.5 text-[12px] text-ink focus:border-accent focus:outline-none";
const CLS_INPUT =
  "h-7 rounded-xs border border-line bg-surface px-2 text-[12px] text-ink focus:border-accent focus:outline-none";
const CLS_SELECT =
  "h-7 appearance-none rounded-xs border border-line bg-surface px-2 text-[12px] text-ink focus:border-accent focus:outline-none";
const CLS_LABEL = "flex flex-col gap-1";
const CLS_LABEL_TEXT =
  "font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-ink-3";

// ─── Field helpers ────────────────────────────────────────────────────────────

function FieldText({
  label,
  value,
  onChange,
  span2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  span2?: boolean;
}) {
  return (
    <label className={`${CLS_LABEL}${span2 ? " col-span-2" : ""}`}>
      <span className={CLS_LABEL_TEXT}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={CLS_INPUT}
      />
    </label>
  );
}

function FieldTextarea({
  label,
  value,
  onChange,
  span2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  span2?: boolean;
}) {
  return (
    <label className={`${CLS_LABEL}${span2 ? " col-span-2" : ""}`}>
      <span className={CLS_LABEL_TEXT}>{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={CLS_TEXTAREA}
      />
    </label>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  span2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  span2?: boolean;
}) {
  return (
    <label className={`${CLS_LABEL}${span2 ? " col-span-2" : ""}`}>
      <span className={CLS_LABEL_TEXT}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={CLS_SELECT}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FieldTagList({
  label,
  values,
  onChange,
  placeholder,
  span2,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  span2?: boolean;
}) {
  return (
    <div className={`${CLS_LABEL}${span2 ? " col-span-2" : ""}`}>
      <span className={CLS_LABEL_TEXT}>{label}</span>
      <TagList values={values} onChange={onChange} placeholder={placeholder} />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DocCoverProps {
  doc: Document;
  onMetadataChange: (metadata: Record<string, unknown>) => void;
}

export function DocCover({ doc, onMetadataChange }: DocCoverProps) {
  const [localMeta, setLocalMeta] = useState<Record<string, unknown>>(
    doc.metadata ?? {}
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset when doc changes (e.g. navigation to a different document)
  useEffect(() => {
    setLocalMeta(doc.metadata ?? {});
  }, [doc.id]);

  const handleChange = useCallback(
    (patch: Record<string, unknown>) => {
      const next = { ...localMeta, ...patch };
      setLocalMeta(next);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        onMetadataChange(next);
      }, 800);
    },
    [localMeta, onMetadataChange]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  function str(key: string): string {
    return (localMeta[key] as string) ?? "";
  }
  function arr(key: string): string[] {
    return (localMeta[key] as string[]) ?? [];
  }
  function acRows(key: string): ACRow[] {
    return (localMeta[key] as ACRow[]) ?? [];
  }
  function techLayers(key: string): TechLayerMap {
    return (localMeta[key] as TechLayerMap) ?? {};
  }
  function steps(key: string): string[] {
    return (localMeta[key] as string[]) ?? [];
  }

  let fields: React.ReactNode = null;

  switch (doc.type) {
    case "brd":
      fields = (
        <>
          <FieldTextarea
            label="Objective"
            value={str("objective")}
            onChange={(v) => handleChange({ objective: v })}
            span2
          />
          <FieldTextarea
            label="Business Need"
            value={str("business_need")}
            onChange={(v) => handleChange({ business_need: v })}
            span2
          />
          <FieldTextarea
            label="Scope"
            value={str("scope")}
            onChange={(v) => handleChange({ scope: v })}
          />
          <FieldTextarea
            label="Out of Scope"
            value={str("out_of_scope")}
            onChange={(v) => handleChange({ out_of_scope: v })}
          />
          <FieldTagList
            label="Stakeholders"
            values={arr("stakeholders")}
            onChange={(v) => handleChange({ stakeholders: v })}
          />
          <FieldTagList
            label="Assumptions"
            values={arr("assumptions")}
            onChange={(v) => handleChange({ assumptions: v })}
          />
        </>
      );
      break;

    case "frd":
      fields = (
        <>
          <FieldText
            label="Related BRD"
            value={str("related_brd")}
            onChange={(v) => handleChange({ related_brd: v })}
          />
          <FieldSelect
            label="Priority"
            value={str("priority") || "med"}
            onChange={(v) => handleChange({ priority: v })}
            options={[
              { value: "high", label: "High" },
              { value: "med", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
          />
          <FieldTextarea
            label="Acceptance Approach"
            value={str("acceptance_approach")}
            onChange={(v) => handleChange({ acceptance_approach: v })}
            span2
          />
        </>
      );
      break;

    case "user_story":
      fields = (
        <>
          <label className="flex flex-col gap-1">
            <span className={CLS_LABEL_TEXT}>As a:</span>
            <input
              value={str("as_a")}
              onChange={(e) => handleChange({ as_a: e.target.value })}
              className={CLS_INPUT}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={CLS_LABEL_TEXT}>I want:</span>
            <input
              value={str("i_want")}
              onChange={(e) => handleChange({ i_want: e.target.value })}
              className={CLS_INPUT}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={CLS_LABEL_TEXT}>So that:</span>
            <input
              value={str("so_that")}
              onChange={(e) => handleChange({ so_that: e.target.value })}
              className={CLS_INPUT}
            />
          </label>
          <div className="col-span-2 flex flex-col gap-1">
            <span className={CLS_LABEL_TEXT}>Acceptance Criteria</span>
            <AcceptanceCriteriaTable
              rows={acRows("acceptance_criteria")}
              onChange={(v) => handleChange({ acceptance_criteria: v })}
            />
          </div>
        </>
      );
      break;

    case "use_case": {
      const mainFlow = steps("main_flow");
      fields = (
        <>
          <FieldTagList
            label="Actors"
            values={arr("actors")}
            onChange={(v) => handleChange({ actors: v })}
          />
          <FieldText
            label="Trigger"
            value={str("trigger")}
            onChange={(v) => handleChange({ trigger: v })}
          />
          <FieldTagList
            label="Preconditions"
            values={arr("preconditions")}
            onChange={(v) => handleChange({ preconditions: v })}
          />
          <div className="col-span-2 flex flex-col gap-1">
            <span className={CLS_LABEL_TEXT}>Main Flow</span>
            <div className="flex flex-col gap-1">
              {mainFlow.map((step, idx) => (
                <div key={idx} className="flex items-center gap-1">
                  <span className="font-mono text-[11px] text-ink-3 w-5 shrink-0">
                    {idx + 1}.
                  </span>
                  <input
                    value={step}
                    onChange={(e) => {
                      const next = [...mainFlow];
                      next[idx] = e.target.value;
                      handleChange({ main_flow: next });
                    }}
                    className={`${CLS_INPUT} flex-1`}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      handleChange({
                        main_flow: mainFlow.filter((_, i) => i !== idx),
                      });
                    }}
                    className="text-[11px] text-ink-3 hover:text-ink"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  handleChange({ main_flow: [...mainFlow, ""] })
                }
                className="self-start text-[11px] font-mono text-ink-3 hover:text-accent"
              >
                + Add Step
              </button>
            </div>
          </div>
          <FieldTextarea
            label="Alt Flows"
            value={str("alt_flows")}
            onChange={(v) => handleChange({ alt_flows: v })}
            span2
          />
        </>
      );
      break;
    }

    case "process_flow":
      fields = (
        <>
          <FieldText
            label="Process Owner"
            value={str("process_owner")}
            onChange={(v) => handleChange({ process_owner: v })}
          />
          <FieldText
            label="Department"
            value={str("department")}
            onChange={(v) => handleChange({ department: v })}
          />
          <FieldText
            label="Trigger Event"
            value={str("trigger_event")}
            onChange={(v) => handleChange({ trigger_event: v })}
          />
        </>
      );
      break;

    case "sdd":
      fields = (
        <>
          <FieldSelect
            label="Architecture Style"
            value={str("architecture_style") || "monolith"}
            onChange={(v) => handleChange({ architecture_style: v })}
            options={[
              { value: "monolith", label: "Monolith" },
              { value: "microservices", label: "Microservices" },
              { value: "serverless", label: "Serverless" },
              { value: "event-driven", label: "Event-Driven" },
            ]}
          />
          <FieldTagList
            label="Key Components"
            values={arr("key_components")}
            onChange={(v) => handleChange({ key_components: v })}
          />
          <FieldTextarea
            label="Key Decisions"
            value={str("key_decisions")}
            onChange={(v) => handleChange({ key_decisions: v })}
            span2
          />
        </>
      );
      break;

    case "adr": {
      const adrStatus = str("status") || "proposed";
      const statusColor: Record<string, string> = {
        proposed: "text-amber-600",
        accepted: "text-green-600",
        deprecated: "text-red-600",
        superseded: "text-ink-3",
      };
      fields = (
        <>
          <div className="flex flex-col gap-1">
            <span className={CLS_LABEL_TEXT}>Status</span>
            <select
              value={adrStatus}
              onChange={(e) => handleChange({ status: e.target.value })}
              className={`${CLS_SELECT} font-semibold ${statusColor[adrStatus] ?? ""}`}
            >
              {[
                { value: "proposed", label: "Proposed" },
                { value: "accepted", label: "Accepted" },
                { value: "deprecated", label: "Deprecated" },
                { value: "superseded", label: "Superseded" },
              ].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <FieldTextarea
            label="Context"
            value={str("context")}
            onChange={(v) => handleChange({ context: v })}
          />
          <FieldTextarea
            label="Decision"
            value={str("decision")}
            onChange={(v) => handleChange({ decision: v })}
          />
          <FieldTextarea
            label="Consequences"
            value={str("consequences")}
            onChange={(v) => handleChange({ consequences: v })}
            span2
          />
          <FieldTagList
            label="Alternatives Considered"
            values={arr("alternatives")}
            onChange={(v) => handleChange({ alternatives: v })}
            span2
          />
        </>
      );
      break;
    }

    case "er_diagram":
      fields = (
        <FieldTextarea
          label="Entity Descriptions"
          value={str("entity_descriptions")}
          onChange={(v) => handleChange({ entity_descriptions: v })}
          span2
        />
      );
      break;

    case "sequence_diagram":
      fields = (
        <FieldTagList
          label="Participants"
          values={arr("participants")}
          onChange={(v) => handleChange({ participants: v })}
          placeholder="Add participant"
          span2
        />
      );
      break;

    case "api_spec":
      fields = (
        <>
          <FieldText
            label="Base URL"
            value={str("base_url")}
            onChange={(v) => handleChange({ base_url: v })}
          />
          <FieldSelect
            label="Auth Type"
            value={str("auth_type") || "none"}
            onChange={(v) => handleChange({ auth_type: v })}
            options={[
              { value: "none", label: "None" },
              { value: "bearer", label: "Bearer Token" },
              { value: "api-key", label: "API Key" },
              { value: "oauth2", label: "OAuth 2.0" },
            ]}
          />
          <FieldText
            label="API Version"
            value={str("api_version")}
            onChange={(v) => handleChange({ api_version: v })}
          />
        </>
      );
      break;

    case "tech_stack":
      fields = (
        <div className="col-span-2">
          <TechStackTable
            layers={techLayers("layers")}
            onChange={(v) => handleChange({ layers: v })}
          />
        </div>
      );
      break;

    case "knowledge_article":
      fields = (
        <>
          <FieldText
            label="Category"
            value={str("category")}
            onChange={(v) => handleChange({ category: v })}
          />
          <FieldTagList
            label="Related Articles"
            values={arr("related_articles")}
            onChange={(v) => handleChange({ related_articles: v })}
          />
        </>
      );
      break;

    case "decision_log":
      fields = (
        <>
          <label className="flex flex-col gap-1">
            <span className={CLS_LABEL_TEXT}>Decision Date</span>
            <input
              type="date"
              value={str("decision_date")}
              onChange={(e) => handleChange({ decision_date: e.target.value })}
              className={CLS_INPUT}
            />
          </label>
          <FieldText
            label="Decider"
            value={str("decider")}
            onChange={(v) => handleChange({ decider: v })}
          />
          <FieldSelect
            label="Outcome"
            value={str("outcome") || "approved"}
            onChange={(v) => handleChange({ outcome: v })}
            options={[
              { value: "approved", label: "Approved" },
              { value: "rejected", label: "Rejected" },
              { value: "deferred", label: "Deferred" },
            ]}
          />
        </>
      );
      break;

    case "qa":
      fields = (
        <FieldSelect
          label="Status"
          value={str("status") || "open"}
          onChange={(v) => handleChange({ status: v })}
          options={[
            { value: "open", label: "Open" },
            { value: "answered", label: "Answered" },
            { value: "closed", label: "Closed" },
          ]}
        />
      );
      break;

    case "lesson_learned":
      fields = (
        <>
          <FieldText
            label="Category"
            value={str("category")}
            onChange={(v) => handleChange({ category: v })}
          />
          <FieldSelect
            label="Impact"
            value={str("impact") || "med"}
            onChange={(v) => handleChange({ impact: v })}
            options={[
              { value: "high", label: "High" },
              { value: "med", label: "Medium" },
              { value: "low", label: "Low" },
            ]}
          />
          <FieldTextarea
            label="Recommendation"
            value={str("recommendation")}
            onChange={(v) => handleChange({ recommendation: v })}
            span2
          />
        </>
      );
      break;

    case "expertise_profile":
      fields = (
        <>
          <FieldText
            label="Role"
            value={str("role")}
            onChange={(v) => handleChange({ role: v })}
          />
          <label className="flex flex-col gap-1">
            <span className={CLS_LABEL_TEXT}>Years Experience</span>
            <input
              type="number"
              min={0}
              value={str("years_experience")}
              onChange={(e) =>
                handleChange({ years_experience: e.target.value })
              }
              className={CLS_INPUT}
            />
          </label>
          <FieldTagList
            label="Skills"
            values={arr("skills")}
            onChange={(v) => handleChange({ skills: v })}
          />
          <FieldTagList
            label="Certifications"
            values={arr("certifications")}
            onChange={(v) => handleChange({ certifications: v })}
          />
        </>
      );
      break;

    default:
      // note, rtm, project_charter, status_report, risk_register, issue_log,
      // change_request, stakeholder_register — no cover panel
      return null;
  }

  return (
    <div className="border-b border-line bg-paper px-4 py-3">
      <div className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
        ◈ {typeLabel(doc.type)} · structured fields
      </div>
      <div className="grid grid-cols-2 gap-3">{fields}</div>
    </div>
  );
}

export default DocCover;
