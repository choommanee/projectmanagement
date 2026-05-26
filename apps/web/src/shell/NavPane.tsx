"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  FolderKanban, ListTodo, Timer, Factory, GitBranch, Workflow,
  ShieldCheck, Network, Users, Settings, Lightbulb, Compass,
  Layers, LayoutDashboard, Circle, Warehouse, ChevronDown,
  type LucideIcon,
} from "lucide-react";
import type { AppDef, AppArea } from "./shell.types";

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
  warehouse: Warehouse,
};

function lsKey(appId: string, areaId: string) {
  return `nav-area-${appId}-${areaId}`;
}

function areaContainsPath(area: AppArea, pathname: string): boolean {
  return area.groups.some((g) =>
    g.subareas.some((sub) => pathname.startsWith(sub.href))
  );
}

function CollapsibleArea({
  area,
  areaIdx,
  app,
  pathname,
}: {
  area: AppArea;
  areaIdx: number;
  app: AppDef;
  pathname: string;
}) {
  const key = lsKey(app.id, area.id);

  // Initialise state: open by default, but read localStorage on first render.
  // We cannot read localStorage during SSR, so we start with `true` then
  // correct via useEffect to avoid hydration mismatch.
  const [open, setOpen] = useState(true);

  useEffect(() => {
    // Force-open if the current path lives inside this area.
    if (areaContainsPath(area, pathname)) {
      setOpen(true);
      return;
    }
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        setOpen(stored === "true");
      }
    } catch {
      // localStorage unavailable — leave default open.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      // ignore
    }
  }

  return (
    <div key={area.id}>
      <button
        type="button"
        onClick={toggle}
        className={`group/area flex w-full items-center gap-1 px-3 mb-1 ${areaIdx === 0 ? "mt-2" : "mt-4"}`}
        aria-expanded={open}
      >
        <span className="flex-1 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
          {area.name}
        </span>
        <ChevronDown
          size={11}
          className={`shrink-0 text-ink-3 transition-transform duration-150 ${open ? "" : "-rotate-90"}`}
        />
      </button>

      {open && (
        <>
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
        </>
      )}
    </div>
  );
}

export function NavPane({ app }: { app: AppDef }) {
  const pathname = usePathname();
  const t = useTranslations("shell");

  return (
    <nav aria-label={t("primaryNav")} className="h-full w-[248px] shrink-0 overflow-y-auto border-r border-line bg-surface py-3 px-2">
      {app.areas.map((area, areaIdx) => (
        <CollapsibleArea
          key={area.id}
          area={area}
          areaIdx={areaIdx}
          app={app}
          pathname={pathname}
        />
      ))}
    </nav>
  );
}
