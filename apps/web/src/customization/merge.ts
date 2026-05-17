type Anything = unknown;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function mergeCustomization<T = Anything>(base: T, overrides: unknown): T {
  if (overrides == null) return base;

  if (Array.isArray(base)) {
    if (isObject(overrides) && Array.isArray((overrides as { _append?: unknown[] })._append)) {
      return [...(base as unknown[]), ...((overrides as { _append: unknown[] })._append)] as unknown as T;
    }
    if (Array.isArray(overrides)) {
      return (base as unknown[]).map((b, i) => mergeCustomization(b, (overrides as unknown[])[i] ?? null)) as unknown as T;
    }
    return base;
  }

  if (isObject(base) && isObject(overrides)) {
    const out: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(overrides)) {
      out[k] = mergeCustomization((base as Record<string, unknown>)[k] as Anything, v);
    }
    return out as T;
  }

  return overrides as T;
}
