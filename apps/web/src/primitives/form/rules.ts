import type { BusinessRule } from "./form.types";

const opRe = /^([a-zA-Z_][\w.]*)\s*(==|!=|>=|<=|>|<)\s*('([^']*)'|"([^"]*)"|-?\d+(?:\.\d+)?|true|false|null)$/;

function evalAtom(expr: string, data: Record<string, unknown>): boolean {
  const m = expr.trim().match(opRe);
  if (!m) return false;
  const [, field, op, fullRhs, sq, dq] = m as unknown as string[];
  const lhs = data[field];
  const rhsStr = sq ?? dq ?? fullRhs;
  const rhs: unknown =
    rhsStr === "true"  ? true :
    rhsStr === "false" ? false :
    rhsStr === "null"  ? null :
    /^-?\d/.test(rhsStr) ? Number(rhsStr) : rhsStr;
  switch (op) {
    case "==": return lhs === rhs;
    case "!=": return lhs !== rhs;
    case ">":  return Number(lhs) >  Number(rhs);
    case "<":  return Number(lhs) <  Number(rhs);
    case ">=": return Number(lhs) >= Number(rhs);
    case "<=": return Number(lhs) <= Number(rhs);
    default:   return false;
  }
}

function evalExpr(expr: string, data: Record<string, unknown>): boolean {
  const parts = expr.split(/\s*(&&|\|\|)\s*/);
  let result = evalAtom(parts[0], data);
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i];
    const v  = evalAtom(parts[i + 1], data);
    result = op === "&&" ? result && v : result || v;
  }
  return result;
}

export interface FieldOverride { readOnly?: boolean; hidden?: boolean; required?: boolean; }

export function evaluateRules(
  rules: BusinessRule[] | undefined,
  data: Record<string, unknown>,
): Record<string, FieldOverride> {
  const out: Record<string, FieldOverride> = {};
  for (const r of rules ?? []) {
    if (!evalExpr(r.when, data)) continue;
    for (const s of r.set ?? []) {
      out[s.field] = { ...(out[s.field] ?? {}), ...s };
    }
  }
  return out;
}
