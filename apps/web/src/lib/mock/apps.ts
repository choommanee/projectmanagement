import type { AppDef } from "@/shell/shell.types";

export const mockApps: AppDef[] = [
  {
    id: "pm", name: "PM Hub",
    areas: [
      { id: "home", name: "Home", groups: [
        { id: "h1", name: "Overview", subareas: [
          { id: "dash",  name: "Dashboard",  href: "/pm/home" },
        ]},
      ]},
      { id: "work", name: "My Work", groups: [
        { id: "w1", name: "Projects", subareas: [
          { id: "projects", name: "Active Projects", href: "/pm/projects" },
          { id: "tasks",    name: "My Tasks",        href: "/pm/tasks" },
          { id: "sprints",  name: "Sprints",         href: "/pm/sprints" },
        ]},
        { id: "w2", name: "Workspaces", subareas: [
          { id: "ba", name: "BA Workspace",     href: "/pm/ba" },
          { id: "sa", name: "SA Workspace",     href: "/pm/sa" },
          { id: "ex", name: "Expert Knowledge", href: "/pm/expert" },
        ]},
      ]},
      { id: "admin", name: "Admin", groups: [
        { id: "a1", name: "Settings", subareas: [
          { id: "tenants",   name: "Tenants",   href: "/pm/tenants" },
          { id: "workflows", name: "Workflows", href: "/pm/workflows" },
        ]},
      ]},
    ],
  },
  {
    id: "mfg", name: "Manufacturing Hub",
    areas: [
      { id: "home", name: "Home", groups: [
        { id: "h1", name: "Overview", subareas: [
          { id: "dash",  name: "Dashboard",  href: "/mfg/home" },
        ]},
      ]},
      { id: "prod", name: "Production", groups: [
        { id: "g1", name: "Orders", subareas: [
          { id: "wo",  name: "Work Orders", href: "/mfg/work-orders" },
          { id: "bom", name: "BOM",         href: "/mfg/bom" },
          { id: "mrp", name: "MRP Run",     href: "/mfg/mrp" },
        ]},
      ]},
      { id: "quality", name: "Quality", groups: [
        { id: "q1", name: "IATF 16949", subareas: [
          { id: "apqp",  name: "APQP",          href: "/mfg/apqp" },
          { id: "ppap",  name: "PPAP",          href: "/mfg/ppap" },
          { id: "fmea",  name: "FMEA",          href: "/mfg/fmea" },
          { id: "trace", name: "Traceability",  href: "/mfg/traceability" },
        ]},
      ]},
    ],
  },
];
