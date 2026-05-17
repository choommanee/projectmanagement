"use client";
import { useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import type { ViewDef } from "./list.types";

export function ViewSelector({ views, value, onChange }: { views: ViewDef[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = views.find((v) => v.id === value) ?? views[0];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-[13px] text-ink hover:border-line-strong"
        aria-label="View"
      >
        <span className="font-medium">{current?.name}</span>
        {current?.isSystem === false && <span className="text-signal">★</span>}
        <ChevronDown size={12} className="text-ink-3" />
      </button>
      {open && (
        <ul role="menu" className="absolute left-0 top-full z-50 mt-1 min-w-56 rounded-sm border border-line bg-surface p-1 shadow-pop">
          {views.map((v) => (
            <li key={v.id}>
              <button
                role="menuitem"
                onClick={() => { onChange(v.id); setOpen(false); }}
                className={`flex w-full items-center justify-between rounded-xs px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${v.id === value ? "text-ink font-medium" : "text-ink-2"}`}
              >
                <span>{v.name}</span>
                {!v.isSystem && <span className="text-[11px] text-signal">★ custom</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
