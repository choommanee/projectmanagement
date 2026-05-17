"use client";
import { useRouter } from "next/navigation";
import { ListView } from "@/primitives/list/ListView";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { mockProjects } from "@/lib/mock/projects";
import type { ListDef } from "@/primitives/list/list.types";

const def: ListDef = {
  entity: "project",
  views: [
    { id: "active", name: "Active Projects", isSystem: true, filter: { field: "status", op: "eq", value: "active" }, columns: [
      { name: "id",       label: "ID",       width: 90 },
      { name: "name",     label: "Name",     width: 240 },
      { name: "status",   label: "Status",   width: 110, kind: "status" },
      { name: "owner",    label: "Owner",    width: 120 },
      { name: "due",      label: "Due",      width: 110, kind: "date" },
      { name: "progress", label: "Progress", width: 90,  kind: "number" },
    ]},
    { id: "all", name: "All Projects", isSystem: true, columns: [
      { name: "id",       label: "ID",       width: 90 },
      { name: "name",     label: "Name",     width: 240 },
      { name: "status",   label: "Status",   width: 110, kind: "status" },
      { name: "owner",    label: "Owner",    width: 120 },
      { name: "due",      label: "Due",      width: 110, kind: "date" },
      { name: "progress", label: "Progress", width: 90,  kind: "number" },
    ]},
  ],
};

export default function Page() {
  const router = useRouter();
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Projects" }]} />
      <CommandBar actions={[
        { id: "new",  label: "+ New",      variant: "primary", onClick: () => alert("Quick Create dialog (mock)") },
        { id: "refr", label: "Refresh",   variant: "ghost",   onClick: () => router.refresh() },
        { id: "exp",  label: "Export",    variant: "ghost",   onClick: () => alert("Export CSV (mock)") },
        { id: "wf",   label: "Workflow ▾",variant: "ghost",   onClick: () => alert("Trigger workflow (mock)") },
      ]} />
      <div className="min-h-0 flex-1">
        <ListView
          def={def}
          rows={mockProjects}
          onRowClick={(r) => router.push(`/pm/projects/${(r as { id: string }).id}`)}
        />
      </div>
    </div>
  );
}
