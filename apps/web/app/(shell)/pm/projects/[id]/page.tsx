"use client";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { ProcessFlowBar } from "@/shell/ProcessFlowBar";
import { FormRenderer } from "@/primitives/form/FormRenderer";
import { findProject } from "@/lib/mock/projects";
import type { FormDef } from "@/primitives/form/form.types";

const def: FormDef = {
  entity: "project",
  header: { titleField: "name", statusField: "status" },
  tabs: [
    { id: "general", label: "General", sections: [
      { id: "s1", label: "Basic", fields: [
        { name: "id",       label: "ID",         kind: "text",   readOnly: true },
        { name: "name",     label: "Name",       kind: "text",   required: true },
        { name: "owner",    label: "Owner",      kind: "lookup", lookup: { entity: "user" } },
        { name: "due",      label: "Due",        kind: "date" },
        { name: "status",   label: "Status",     kind: "select", options: [
          { value: "planning",  label: "Planning"  },
          { value: "active",    label: "Active"    },
          { value: "completed", label: "Completed" },
        ]},
        { name: "progress", label: "Progress %", kind: "number" },
      ]},
    ]},
    { id: "tasks", label: "Tasks", sections: [
      { id: "ts", label: "Linked tasks", fields: [
        { name: "tasksNote", label: "Note", kind: "text", placeholder: "Subgrid would render here", readOnly: true },
      ]},
    ]},
    { id: "risks", label: "Risks", sections: [
      { id: "rs", label: "RAID register", fields: [
        { name: "raidNote", label: "Note", kind: "text", placeholder: "Risk register would render here", readOnly: true },
      ]},
    ]},
  ],
  rules: [
    { when: "status == 'completed'", set: [{ field: "progress", readOnly: true }] },
  ],
};

const stages = [
  { id: "planning",  label: "Planning"  },
  { id: "active",    label: "Active"    },
  { id: "completed", label: "Completed" },
];

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const initial = findProject(id);
  const router = useRouter();
  const [val, setVal] = useState<Record<string, unknown>>((initial ?? { id }) as Record<string, unknown>);
  if (!initial) return <div className="p-6 text-sm text-fgMuted">Project {id} not found.</div>;

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[
        { label: "Home", href: "/pm/home" },
        { label: "Projects", href: "/pm/projects" },
        { label: String(val.id) },
      ]} />
      <CommandBar actions={[
        { id: "save",      label: "Save",         variant: "primary", onClick: () => alert("Saved (mock)") },
        { id: "saveclose", label: "Save & Close", variant: "ghost",   onClick: () => router.push("/pm/projects") },
        { id: "del",       label: "Delete",       variant: "ghost",   onClick: () => alert("Delete (mock)") },
        { id: "share",     label: "Share",        variant: "ghost",   onClick: () => alert("Share link (mock)") },
        { id: "wf",        label: "Workflow ▾",   variant: "ghost",   onClick: () => alert("Trigger workflow (mock)") },
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
