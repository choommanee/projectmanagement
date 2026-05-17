import type { FilterClause } from "./list.types";

export function applyFilter(rows: Record<string, unknown>[], f?: FilterClause): Record<string, unknown>[] {
  if (!f) return rows;
  return rows.filter((r) => {
    const v = r[f.field];
    switch (f.op) {
      case "eq":       return v === f.value;
      case "neq":      return v !== f.value;
      case "contains": return typeof v === "string" && typeof f.value === "string" && v.includes(f.value);
      case "gt":       return Number(v) >  Number(f.value);
      case "lt":       return Number(v) <  Number(f.value);
      case "gte":      return Number(v) >= Number(f.value);
      case "lte":      return Number(v) <= Number(f.value);
      case "in":       return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
    }
  });
}
