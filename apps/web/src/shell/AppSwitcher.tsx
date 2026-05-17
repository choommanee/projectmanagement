"use client";
import { useState } from "react";

interface AppMeta { id: string; name: string }

export function AppSwitcher({
  current, apps, onSelect,
}: { current: string; apps: AppMeta[]; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const cur = apps.find((a) => a.id === current);
  return (
    <div className="relative">
      <button
        className="rounded-md px-2 py-1 text-sm font-medium hover:bg-bgMuted"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
      >
        {cur?.name ?? "Select app"} ▾
      </button>
      {open && (
        <ul role="menu" className="absolute z-50 mt-1 min-w-48 rounded-md border border-border bg-bg p-1 shadow-md">
          {apps.map((a) => (
            <li key={a.id}>
              <button
                role="menuitem"
                onClick={() => { onSelect(a.id); setOpen(false); }}
                className={`block w-full rounded px-2 py-1 text-left text-sm hover:bg-bgMuted ${a.id === current ? "font-semibold" : ""}`}
              >
                {a.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
