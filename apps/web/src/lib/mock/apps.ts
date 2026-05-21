import type { AppDef } from "@/shell/shell.types";

export const mockApps: AppDef[] = [
  {
    id: "pm", name: "PM Hub",
    areas: [
      { id: "home", name: "Home", groups: [
        { id: "h1", name: "Overview", subareas: [
          { id: "dash",  name: "Dashboard",  href: "/pm/home",    icon: "dashboard" },
        ]},
      ]},
      { id: "work", name: "My Work", groups: [
        { id: "w1", name: "Projects", subareas: [
          { id: "projects", name: "Active Projects", href: "/pm/projects", icon: "folder",    count: 7  },
          { id: "tasks",    name: "My Tasks",        href: "/pm/tasks",    icon: "tasks",     count: 12 },
          { id: "sprints",  name: "Sprints",         href: "/pm/sprints",  icon: "sprint",    count: 2  },
          { id: "inbox",    name: "My Tasks (Approvals)", href: "/pm/inbox", icon: "tasks",   count: 0  },
        ]},
        { id: "w2", name: "Workspaces", subareas: [
          { id: "ba", name: "BA Workspace",     href: "/pm/ba",     icon: "ba"        },
          { id: "sa", name: "SA Workspace",     href: "/pm/sa",     icon: "sa"        },
          { id: "ex", name: "Expert Knowledge", href: "/pm/expert", icon: "knowledge" },
        ]},
      ]},
      { id: "admin", name: "Admin", groups: [
        { id: "a1", name: "Settings", subareas: [
          { id: "tenants",   name: "Tenants",        href: "/pm/tenants",   icon: "people"   },
          { id: "workflows", name: "Workflows",      href: "/pm/workflows", icon: "workflow" },
          { id: "audit",     name: "Audit Explorer", href: "/pm/audit",     icon: "settings" },
          { id: "reports",   name: "Reports & BI",   href: "/pm/reports",   icon: "dashboard" },
        ]},
      ]},
    ],
  },
  {
    id: "mfg", name: "Manufacturing Hub",
    areas: [
      { id: "home", name: "Home", groups: [
        { id: "h1", name: "Overview", subareas: [
          { id: "dash",  name: "Dashboard",  href: "/mfg/home", icon: "dashboard" },
        ]},
      ]},
      { id: "prod", name: "Production", groups: [
        { id: "g1", name: "Orders", subareas: [
          { id: "wo",  name: "Work Orders", href: "/mfg/work-orders", icon: "factory", count: 6 },
          { id: "bom", name: "BOM",         href: "/mfg/bom",         icon: "bom"               },
          { id: "mrp", name: "MRP Run",     href: "/mfg/mrp",         icon: "workflow"           },
        ]},
        { id: "g2", name: "Master Data", subareas: [
          { id: "items",       name: "Items",        href: "/mfg/items",        icon: "factory"  },
          { id: "workcenters", name: "Work Centers", href: "/mfg/work-centers", icon: "workflow" },
          { id: "uoms",        name: "UoMs",         href: "/mfg/uoms",         icon: "tasks"    },
        ]},
      ]},
      { id: "quality", name: "Quality", groups: [
        { id: "q1", name: "IATF 16949", subareas: [
          { id: "apqp",  name: "APQP",          href: "/mfg/apqp",          icon: "quality" },
          { id: "ppap",  name: "PPAP",          href: "/mfg/ppap",          icon: "quality" },
          { id: "fmea",  name: "FMEA",          href: "/mfg/fmea",          icon: "quality" },
          { id: "cp",    name: "Control Plans", href: "/mfg/control-plans", icon: "quality" },
          { id: "ncrs",  name: "NCR / CAPA",   href: "/mfg/ncrs",          icon: "quality" },
          { id: "insp",  name: "Inspections",   href: "/mfg/inspections",   icon: "quality" },
          { id: "trace", name: "Traceability",  href: "/mfg/traceability",  icon: "trace"   },
        ]},
      ]},
    ],
  },
];
