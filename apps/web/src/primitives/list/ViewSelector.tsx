"use client";
import type { ViewDef } from "./list.types";

export function ViewSelector({ views, value, onChange }:
  { views: ViewDef[]; value: string; onChange: (id: string) => void }) {
  return (
    <select
      className="h-7 rounded-md border border-border bg-bg px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="View"
    >
      {views.map((v) => <option key={v.id} value={v.id}>{v.name}{v.isSystem ? "" : " ★"}</option>)}
    </select>
  );
}
