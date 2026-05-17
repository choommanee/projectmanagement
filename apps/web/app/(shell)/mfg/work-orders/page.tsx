"use client";
import { useRouter } from "next/navigation";
import { ListView } from "@/primitives/list/ListView";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { mockWOs } from "@/lib/mock/workorders";
import type { ListDef } from "@/primitives/list/list.types";

const def: ListDef = {
  entity: "work_order",
  views: [
    { id: "active", name: "Active WOs", isSystem: true, filter: { field: "status", op: "neq", value: "completed" }, columns: [
      { name: "id",         label: "WO #",        width: 160 },
      { name: "item",       label: "Item",        width: 160 },
      { name: "qty",        label: "Qty",         width: 80 },
      { name: "status",     label: "Status",      width: 120 },
      { name: "workCenter", label: "Work Center", width: 130 },
      { name: "due",        label: "Due",         width: 110 },
      { name: "priority",   label: "Priority",    width: 90 },
    ]},
    { id: "all", name: "All WOs", isSystem: true, columns: [
      { name: "id",         label: "WO #",        width: 160 },
      { name: "item",       label: "Item",        width: 160 },
      { name: "qty",        label: "Qty",         width: 80 },
      { name: "status",     label: "Status",      width: 120 },
      { name: "workCenter", label: "Work Center", width: 130 },
      { name: "due",        label: "Due",         width: 110 },
    ]},
  ],
};

export default function Page() {
  const router = useRouter();
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Work Orders" }]} />
      <CommandBar actions={[
        { id: "new", label: "+ New WO",   variant: "primary", onClick: () => alert("Create WO (mock)") },
        { id: "rel", label: "Release",    variant: "ghost",   onClick: () => alert("Release WO (mock)") },
        { id: "wf",  label: "Workflow ▾", variant: "ghost",   onClick: () => alert("Trigger workflow (mock)") },
      ]} />
      <div className="min-h-0 flex-1">
        <ListView
          def={def}
          rows={mockWOs as never}
          onRowClick={(r) => router.push(`/mfg/work-orders/${encodeURIComponent((r as { id: string }).id)}`)}
        />
      </div>
    </div>
  );
}
