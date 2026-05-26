"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FolderKanban,
  Factory,
  BookOpen,
  Users,
  Package,
  TrendingUp,
  ShieldCheck,
  FileText,
  LayoutGrid,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";

interface AppMeta { id: string; name: string }

const APP_ICONS: Record<string, LucideIcon> = {
  pm:          FolderKanban,
  mfg:         Factory,
  accounting:  BookOpen,
  hr:          Users,
  procurement: Package,
  sales:       TrendingUp,
  docs:        FileText,
  quality:     ShieldCheck,
};

function AppIcon({ id, size = 20, className }: { id: string; size?: number; className?: string }) {
  const Icon = APP_ICONS[id] ?? LayoutGrid;
  return <Icon size={size} className={className} />;
}

export function AppSwitcher({
  current, apps, onSelect,
}: { current: string; apps: AppMeta[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const cur = apps.find((a) => a.id === current);
  const t = useTranslations("shell");

  /* close on outside click */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      {/* Trigger */}
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 h-9 text-sm font-medium text-ink-2 hover:text-ink hover:bg-surface-2 border border-transparent hover:border-line transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <LayoutGrid size={14} className="text-ink-3 shrink-0" />
        <span className="leading-none">{cur?.name ?? t("selectApp")}</span>
        <ChevronDown size={12} className="text-ink-3 shrink-0" />
      </button>

      {/* Grid dropdown */}
      {open && (
        <div
          role="dialog"
          aria-label={t("selectApp")}
          className="absolute left-0 top-full z-50 mt-1 w-[248px] rounded-sm border border-line bg-surface shadow-pop p-2"
        >
          <p className="mb-2 px-1 text-[11px] font-medium uppercase tracking-widest text-ink-3">
            {t("selectApp")}
          </p>

          <div className="grid grid-cols-2 gap-1.5">
            {apps.map((a) => {
              const isActive = a.id === current;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="menuitem"
                  onClick={() => { onSelect(a.id); setOpen(false); }}
                  className={[
                    "flex flex-col items-center gap-1.5 p-3 rounded-sm border transition-colors",
                    isActive
                      ? "bg-accent/10 border-accent text-ink cursor-default"
                      : "bg-surface border-line hover:bg-surface-2 hover:border-accent text-ink-2 hover:text-ink cursor-pointer",
                  ].join(" ")}
                >
                  <AppIcon
                    id={a.id}
                    size={20}
                    className={isActive ? "text-accent" : "text-ink-3 group-hover:text-ink-2"}
                  />
                  <span className="text-xs font-medium leading-tight text-center">
                    {a.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
