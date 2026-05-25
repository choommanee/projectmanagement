"use client";

import { useState } from "react";
import { Save, RefreshCw } from "lucide-react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { DashboardBuilder, type Widget } from "@/components/DashboardBuilder";

const DEFAULT_WIDGETS: Widget[] = [
  { id: "w1", type: "kpi",   title: "Open Tasks",  dataKey: "tasks.open",       value: 24 },
  { id: "w2", type: "kpi",   title: "In Progress", dataKey: "tasks.inProgress", value: 8  },
  { id: "w3", type: "kpi",   title: "Done Today",  dataKey: "tasks.doneToday",  value: 3  },
];

const STORAGE_KEY = "pm-dashboard-widgets";

function loadWidgets(): Widget[] {
  if (typeof window === "undefined") return DEFAULT_WIDGETS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Widget[]) : DEFAULT_WIDGETS;
  } catch {
    return DEFAULT_WIDGETS;
  }
}

export default function DashboardPage() {
  const [widgets, setWidgets] = useState<Widget[]>(loadWidgets);

  function saveWidgets(ws: Widget[]) {
    setWidgets(ws);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
    }
  }

  return (
    <div className="flex flex-col h-full">
      <Breadcrumb
        items={[
          { label: "PM Hub",  href: "/pm/home"    },
          { label: "Reports", href: "/pm/reports"  },
          { label: "Dashboard Builder" },
        ]}
      />
      <CommandBar
        actions={[
          {
            id:      "save",
            label:   "Save Layout",
            icon:    <Save size={14} />,
            onClick: () => {
              if (typeof window !== "undefined") {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
              }
            },
          },
          {
            id:      "reset",
            label:   "Reset",
            icon:    <RefreshCw size={14} />,
            onClick: () => saveWidgets(DEFAULT_WIDGETS),
          },
        ]}
      />

      <div className="flex-1 overflow-auto p-4">
        <DashboardBuilder widgets={widgets} onWidgetsChange={saveWidgets} />
      </div>
    </div>
  );
}
