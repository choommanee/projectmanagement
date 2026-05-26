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
          { id: "backlog",  name: "Backlog",         href: "/pm/backlog",  icon: "tasks"                },
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
          { id: "tenants",       name: "Tenants",          href: "/pm/tenants",         icon: "people"    },
          { id: "users",         name: "Users",            href: "/pm/users",           icon: "people"    },
          { id: "custom-fields", name: "Custom Fields",    href: "/pm/tenants/fields",  icon: "settings"  },
          { id: "workflows",     name: "Workflows",        href: "/pm/workflows",       icon: "workflow"  },
          { id: "audit",         name: "Audit Explorer",   href: "/pm/audit",           icon: "settings"  },
          { id: "reports",       name: "Reports & BI",     href: "/pm/reports",         icon: "dashboard" },
          { id: "dash-builder",  name: "Dashboard Builder",href: "/pm/reports/dashboard", icon: "dashboard" },
          { id: "integration",   name: "Order Integration", href: "/pm/integration",       icon: "workflow"  },
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
          { id: "wo",             name: "Work Orders",    href: "/mfg/work-orders",   icon: "factory",  count: 6 },
          { id: "purchase-orders",name: "Purchase Orders",href: "/mfg/purchase-orders",icon: "tasks"           },
          { id: "bom",            name: "BOM",            href: "/mfg/bom",           icon: "bom"              },
          { id: "mrp",            name: "MRP Run",        href: "/mfg/mrp",           icon: "workflow"         },
          { id: "scheduling",     name: "Scheduling Board",href: "/mfg/scheduling",  icon: "workflow"         },
        ]},
        { id: "g2", name: "Master Data", subareas: [
          { id: "items",       name: "Items",        href: "/mfg/items",        icon: "factory"   },
          { id: "suppliers",   name: "Suppliers",    href: "/mfg/suppliers",    icon: "factory"   },
          { id: "workcenters", name: "Work Centers", href: "/mfg/work-centers", icon: "workflow"  },
          { id: "uoms",        name: "UoMs",         href: "/mfg/uoms",         icon: "tasks"     },
          { id: "inventory",   name: "Inventory",    href: "/mfg/inventory",    icon: "warehouse" },
          { id: "lots",        name: "Lots",          href: "/mfg/lots",         icon: "warehouse" },
          { id: "routings",    name: "Routings",      href: "/mfg/routings",     icon: "bom"       },
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
  {
    id: "accounting", name: "Accounting Hub",
    areas: [
      { id: "home", name: "Home", groups: [
        { id: "h1", name: "Overview", subareas: [
          { id: "dash", name: "Dashboard", href: "/accounting/home", icon: "dashboard" },
        ]},
      ]},
      { id: "ledger", name: "General Ledger", groups: [
        { id: "l1", name: "Accounts", subareas: [
          { id: "coa",     name: "Chart of Accounts", href: "/accounting/accounts",        icon: "dashboard" },
          { id: "je",      name: "Journal Entries",   href: "/accounting/journal-entries", icon: "tasks"     },
          { id: "trial-balance", name: "Trial Balance",    href: "/accounting/reports",         icon: "dashboard" },
        ]},
      ]},
      { id: "billing", name: "Billing", groups: [
        { id: "b1", name: "Documents", subareas: [
          { id: "inv", name: "Invoices", href: "/accounting/invoices", icon: "tasks" },
        ]},
      ]},
    ],
  },
  {
    id: "hr", name: "HR Hub",
    areas: [
      { id: "home", name: "Home", groups: [
        { id: "h1", name: "Overview", subareas: [
          { id: "dash", name: "Dashboard", href: "/hr/home", icon: "dashboard" },
        ]},
      ]},
      { id: "org", name: "Organization", groups: [
        { id: "o1", name: "Structure", subareas: [
          { id: "depts",   name: "Departments", href: "/hr/departments", icon: "people"  },
          { id: "pos",     name: "Positions",   href: "/hr/positions",   icon: "people"  },
          { id: "emps",    name: "Employees",   href: "/hr/employees",   icon: "people"  },
          { id: "payroll", name: "Payroll",     href: "/hr/payroll",     icon: "tasks"   },
          { id: "leave",   name: "Leave Requests", href: "/hr/leave",   icon: "tasks"   },
        ]},
      ]},
    ],
  },
  {
    id: "procurement", name: "Procurement Hub",
    areas: [
      { id: "home", name: "Home", groups: [
        { id: "h1", name: "Overview", subareas: [
          { id: "dash", name: "Dashboard", href: "/procurement/home", icon: "dashboard" },
        ]},
      ]},
      { id: "purchasing", name: "Purchasing", groups: [
        { id: "p1", name: "Orders", subareas: [
          { id: "purchase-orders", name: "Purchase Orders", href: "/procurement/purchase-orders", icon: "tasks" },
        ]},
        { id: "p2", name: "Vendors", subareas: [
          { id: "suppliers", name: "Suppliers", href: "/procurement/suppliers", icon: "people" },
        ]},
      ]},
    ],
  },
  {
    id: "sales", name: "Sales Hub",
    areas: [
      { id: "home", name: "Home", groups: [
        { id: "h1", name: "Overview", subareas: [
          { id: "dash", name: "Dashboard", href: "/sales/home", icon: "dashboard" },
        ]},
      ]},
      { id: "crm", name: "CRM", groups: [
        { id: "c1", name: "Accounts", subareas: [
          { id: "customers",    name: "Customers",    href: "/sales/customers",    icon: "people" },
          { id: "sales-orders", name: "Sales Orders", href: "/sales/orders",       icon: "tasks"  },
        ]},
      ]},
    ],
  },
  {
    id: "quality", name: "Quality Hub",
    areas: [
      { id: "home", name: "Home", groups: [
        { id: "h1", name: "Overview", subareas: [
          { id: "dash", name: "Dashboard", href: "/quality/home", icon: "dashboard" },
        ]},
      ]},
      { id: "apqp-area", name: "APQP / PPAP", groups: [
        { id: "q1", name: "Planning", subareas: [
          { id: "apqp", name: "APQP Projects",  href: "/quality/apqp",          icon: "quality" },
          { id: "ppap", name: "PPAP Packages",  href: "/quality/ppap",          icon: "quality" },
          { id: "fmea", name: "FMEA",           href: "/quality/fmea",          icon: "quality" },
          { id: "cp",   name: "Control Plans",  href: "/quality/control-plans", icon: "quality" },
        ]},
      ]},
      { id: "ops", name: "Operations", groups: [
        { id: "q2", name: "Execution", subareas: [
          { id: "ncrs",  name: "NCR / CAPA",   href: "/quality/ncrs",         icon: "quality" },
          { id: "insp",  name: "Inspections",  href: "/quality/inspections",  icon: "quality" },
          { id: "trace", name: "Traceability", href: "/quality/traceability", icon: "trace"   },
        ]},
      ]},
    ],
  },
];
