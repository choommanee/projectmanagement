export type FieldKind = "text" | "number" | "select" | "date" | "boolean" | "lookup";

export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  readOnly?: boolean;
  hidden?: boolean;
  options?: { value: string; label: string }[];
  lookup?: { entity: string; valueField?: string; labelField?: string };
  placeholder?: string;
  defaultValue?: unknown;
}

export interface SectionDef {
  id: string;
  label: string;
  columns?: 1 | 2;
  fields: FieldDef[];
}

export interface TabDef {
  id: string;
  label: string;
  sections: SectionDef[];
}

export interface BusinessRule {
  when: string;
  set?: { field: string; readOnly?: boolean; hidden?: boolean; required?: boolean }[];
}

export interface FormDef {
  entity: string;
  header?: { titleField: string; statusField?: string; subtitleFields?: string[] };
  tabs: TabDef[];
  rules?: BusinessRule[];
}
