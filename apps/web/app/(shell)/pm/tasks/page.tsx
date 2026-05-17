"use client";
import { useRouter } from "next/navigation";
import { ListView } from "@/primitives/list/ListView";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { mockTasks } from "@/lib/mock/tasks";
import type { ListDef } from "@/primitives/list/list.types";

const def: ListDef = {
  entity: "task",
  views: [
    { id: "open", name: "Open Tasks", isSystem: true, filter: { field: "status", op: "neq", value: "done" }, columns: [
      { name: "id",         label: "ID",       width: 90 },
      { name: "title",      label: "Title",    width: 280 },
      { name: "type",       label: "Type",     width: 90 },
      { name: "status",     label: "Status",   width: 110 },
      { name: "assignee",   label: "Assignee", width: 120 },
      { name: "estimateMd", label: "Est (md)", width: 80 },
      { name: "actualMd",   label: "Act (md)", width: 80 },
      { name: "due",        label: "Due",      width: 110 },
    ]},
    { id: "all", name: "All Tasks", isSystem: true, columns: [
      { name: "id",       label: "ID",       width: 90 },
      { name: "title",    label: "Title",    width: 280 },
      { name: "type",     label: "Type",     width: 90 },
      { name: "status",   label: "Status",   width: 110 },
      { name: "assignee", label: "Assignee", width: 120 },
      { name: "due",      label: "Due",      width: 110 },
    ]},
  ],
};

export default function Page() {
  const router = useRouter();
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Tasks" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New",   variant: "primary", onClick: () => alert("Quick Create (mock)") },
        { id: "ref", label: "Refresh", variant: "ghost",   onClick: () => router.refresh() },
      ]} />
      <div className="min-h-0 flex-1">
        <ListView
          def={def}
          rows={mockTasks as never}
          onRowClick={(r) => alert("Task detail: " + (r as { id: string }).id)}
        />
      </div>
    </div>
  );
}
