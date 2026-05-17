"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderKanban, ListTodo, Timer, Factory, GitBranch, Workflow,
  ShieldCheck, Network, Users, Settings, Lightbulb, Compass,
  Layers, LayoutDashboard, Circle,
  type LucideIcon,
} from "lucide-react";
import type { AppDef } from "./shell.types";

const ICON_MAP: Record<string, LucideIcon> = {
  folder:    FolderKanban,
  tasks:     ListTodo,
  sprint:    Timer,
  factory:   Factory,
  bom:       GitBranch,
  workflow:  Workflow,
  quality:   ShieldCheck,
  trace:     Network,
  people:    Users,
  settings:  Settings,
  knowledge: Lightbulb,
  ba:        Compass,
  sa:        Layers,
  dashboard: LayoutDashboard,
};

export function NavPane({ app }: { app: AppDef }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="h-full w-[248px] shrink-0 overflow-y-auto border-r border-line bg-surface py-3 px-2">
      {app.areas.map((area, areaIdx) => (
        <div key={area.id}>
          <div className={`text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3 px-3 mb-1 ${areaIdx === 0 ? "mt-2" : "mt-4"}`}>
            {area.name}
          </div>
          {area.groups.map((g) => (
            <div key={g.id}>
              {g.name && (
                <div className="text-[11px] text-ink-3 px-3 mt-3 mb-1">{g.name}</div>
              )}
              <ul>
                {g.subareas.map((sub) => {
                  const active = pathname === sub.href;
                  const IconComponent: LucideIcon = sub.icon ? (ICON_MAP[sub.icon] ?? Circle) : Circle;
                  return (
                    <li key={sub.id}>
                      <Link
                        href={sub.href}
                        className={`group relative flex items-center gap-2 h-8 px-3 rounded-sm text-sm transition-colors
                          ${active
                            ? "bg-accent-soft text-ink font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-4 before:w-[2px] before:rounded-r before:bg-accent"
                            : "text-ink-2 hover:text-ink hover:bg-surface-2"
                          }`}
                      >
                        <IconComponent size={14} className="shrink-0" />
                        <span className="flex-1 truncate">{sub.name}</span>
                        {sub.count !== undefined && (
                          <span className={`ml-auto rounded-xs px-1.5 py-px font-mono text-[10px] tabular-nums ${active ? "bg-accent text-white" : "bg-surface-2 text-ink-3"}`}>
                            {sub.count}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </nav>
  );
}
