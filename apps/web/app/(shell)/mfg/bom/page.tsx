"use client";
import { ListView } from "@/primitives/list/ListView";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { mockBOM } from "@/lib/mock/bom";
import type { ListDef } from "@/primitives/list/list.types";

const def: ListDef = {
  entity: "bom",
  views: [
    { id: "all", name: "BRK-ASSY-V2 (multi-level)", isSystem: true, columns: [
      { name: "level",  label: "Lv",     width: 50 },
      { name: "parent", label: "Parent", width: 160 },
      { name: "child",  label: "Child",  width: 200 },
      { name: "qty",    label: "Qty",    width: 80 },
      { name: "uom",    label: "UoM",    width: 60 },
    ]},
  ],
};

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "BOM" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New BOM", variant: "primary", onClick: () => alert("New BOM (mock)") },
        { id: "ver", label: "Version",   variant: "ghost",   onClick: () => alert("Create version (mock)") },
        { id: "exp", label: "Explode",   variant: "ghost",   onClick: () => alert("Explode BOM (mock)") },
      ]} />
      <div className="min-h-0 flex-1">
        <ListView def={def} rows={mockBOM as never} />
      </div>
    </div>
  );
}
