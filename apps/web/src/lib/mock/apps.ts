import type { AppDef } from "@/shell/shell.types";

export const mockApps: AppDef[] = [
  {
    id: "pm", name: "PM Hub",
    areas: [
      { id: "work", name: "My Work", groups: [
        { id: "g1", name: "Projects", subareas: [
          { id: "active",  name: "Active Projects",  href: "/pm/projects" },
          { id: "tasks",   name: "My Tasks",         href: "/pm/tasks" },
        ]},
      ]},
    ],
  },
  {
    id: "mfg", name: "Manufacturing Hub",
    areas: [
      { id: "prod", name: "Production", groups: [
        { id: "g1", name: "Orders", subareas: [
          { id: "wo",  name: "Work Orders", href: "/mfg/work-orders" },
          { id: "bom", name: "BOM",         href: "/mfg/bom" },
        ]},
      ]},
    ],
  },
];
