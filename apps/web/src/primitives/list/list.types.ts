export interface ColumnDef {
  name: string;
  label: string;
  width?: number;
  kind?: "text" | "number" | "date" | "status";
  hidden?: boolean;
}

export interface ViewDef {
  id: string;
  name: string;
  isSystem?: boolean;
  columns: ColumnDef[];
  filter?: FilterClause;
  sort?: { field: string; dir: "asc" | "desc" }[];
}

export interface FilterClause {
  field: string;
  op: "eq" | "neq" | "contains" | "gt" | "lt" | "gte" | "lte" | "in";
  value: unknown;
}

export interface ListDef {
  entity: string;
  views: ViewDef[];
}
