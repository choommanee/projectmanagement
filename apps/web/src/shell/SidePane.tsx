"use client";
import { X } from "lucide-react";
import { useUi } from "@/lib/store";
import type { ReactNode } from "react";

export function SidePane({ children }: { children: ReactNode }) {
  const { sidePaneOpen, setSidePaneOpen } = useUi();
  if (!sidePaneOpen) return null;
  return (
    <aside className="w-80 shrink-0 border-l border-line bg-paper" aria-label="Context pane">
      <div className="flex items-center justify-between border-b border-line p-2">
        <span className="text-sm font-medium">Context</span>
        <button aria-label="Close" onClick={() => setSidePaneOpen(false)}><X size={14} /></button>
      </div>
      <div className="p-3">{children}</div>
    </aside>
  );
}
