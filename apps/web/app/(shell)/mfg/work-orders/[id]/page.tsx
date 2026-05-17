"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { ProcessFlowBar } from "@/shell/ProcessFlowBar";
import { FormRenderer } from "@/primitives/form/FormRenderer";
import { findWO } from "@/lib/mock/workorders";
import type { FormDef } from "@/primitives/form/form.types";

const def: FormDef = {
  entity: "work_order",
  header: { titleField: "id", statusField: "status" },
  tabs: [
    { id: "general", label: "General", sections: [
      { id: "s1", label: "Order", fields: [
        { name: "id",         label: "WO #",        kind: "text",   readOnly: true },
        { name: "item",       label: "Item",        kind: "lookup", lookup: { entity: "item" } },
        { name: "qty",        label: "Qty",         kind: "number", required: true },
        { name: "workCenter", label: "Work Center", kind: "text" },
        { name: "due",        label: "Due Date",    kind: "date" },
        { name: "priority",   label: "Priority",    kind: "select", options: [
          { value: "low",  label: "Low"    },
          { value: "med",  label: "Medium" },
          { value: "high", label: "High"   },
        ]},
      ]},
    ]},
    { id: "routing",  label: "Routing",      sections: [{ id: "r1", label: "Operations",  fields: [{ name: "routingNote", label: "Note", kind: "text", placeholder: "Operations subgrid",           readOnly: true }] }] },
    { id: "mat",      label: "Materials",    sections: [{ id: "m1", label: "Components",  fields: [{ name: "matNote",     label: "Note", kind: "text", placeholder: "Material requirements subgrid", readOnly: true }] }] },
    { id: "qual",     label: "Quality",      sections: [{ id: "q1", label: "Inspection",  fields: [{ name: "qualNote",    label: "Note", kind: "text", placeholder: "Quality plan + measurements",   readOnly: true }] }] },
    { id: "trace",    label: "Traceability", sections: [{ id: "t1", label: "Genealogy",   fields: [{ name: "traceNote",   label: "Note", kind: "text", placeholder: "Lot/serial genealogy graph",    readOnly: true }] }] },
  ],
};

const stages = [
  { id: "planned",     label: "Planned"     },
  { id: "released",    label: "Released"    },
  { id: "in_progress", label: "In Progress" },
  { id: "completed",   label: "Completed"   },
];

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const initial = findWO(decodeURIComponent(id));
  const router = useRouter();
  const [val, setVal] = useState<Record<string, unknown>>((initial ?? { id }) as Record<string, unknown>);
  if (!initial) return <div className="p-6 text-sm text-fgMuted">WO {id} not found.</div>;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[
        { label: "Home", href: "/mfg/home" },
        { label: "Work Orders", href: "/mfg/work-orders" },
        { label: String(val.id) },
      ]} />
      <CommandBar actions={[
        { id: "save", label: "Save",         variant: "primary", onClick: () => alert("Saved (mock)") },
        { id: "sc",   label: "Save & Close", variant: "ghost",   onClick: () => router.push("/mfg/work-orders") },
        { id: "rel",  label: "Release",      variant: "ghost",   onClick: () => alert("Release (mock)") },
        { id: "wf",   label: "Workflow ▾",   variant: "ghost",   onClick: () => alert("Trigger workflow (mock)") },
      ]} />
      <div className="px-4 pt-2">
        <ProcessFlowBar stages={stages} current={String(val.status)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <FormRenderer def={def} value={val} onChange={setVal} />
      </div>
    </div>
  );
}
