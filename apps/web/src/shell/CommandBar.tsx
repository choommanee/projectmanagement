"use client";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Button } from "@pmplatform/ui-kit";

export interface CommandAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
}

export function CommandBar({ actions, maxVisible = 6 }: { actions: CommandAction[]; maxVisible?: number }) {
  const visible = actions.slice(0, maxVisible);
  const overflow = actions.slice(maxVisible);
  const [open, setOpen] = useState(false);

  return (
    <div role="toolbar" aria-label="Commands" className="flex items-center gap-1 border-b border-border bg-bg px-3 py-1.5">
      {visible.map((a) => (
        <Button key={a.id} variant={a.variant ?? "ghost"} size="sm" onClick={a.onClick} disabled={a.disabled}>
          {a.icon}
          <span className={a.icon ? "ml-1" : ""}>{a.label}</span>
        </Button>
      ))}
      {overflow.length > 0 && (
        <div className="relative">
          <Button variant="ghost" size="sm" aria-label="More" onClick={() => setOpen((v) => !v)}>
            <MoreHorizontal size={14} />
          </Button>
          {open && (
            <ul className="absolute right-0 top-full z-50 mt-1 min-w-40 rounded-md border border-border bg-bg p-1 shadow-md">
              {overflow.map((a) => (
                <li key={a.id}>
                  <button
                    className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-bgMuted"
                    onClick={() => { a.onClick(); setOpen(false); }}
                  >
                    {a.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
