import type { LucideIcon } from "lucide-react";
import { Hammer } from "lucide-react";

export function ComingSoon({ title, description, icon: Icon = Hammer, plan }:
  { title: string; description: string; icon?: LucideIcon; plan?: string }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="relative w-full max-w-md rounded-md border border-dashed border-line-strong bg-surface p-8 text-center shadow-xs">
        <div className="grid h-12 w-12 mx-auto place-items-center rounded-sm bg-accent-soft text-accent">
          <Icon size={20} />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-ink">{title}</h2>
        <p className="mt-1.5 text-sm text-ink-3">{description}</p>
        {plan && (
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-xs bg-surface-2 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-ink-3">
            📅 {plan}
          </div>
        )}
      </div>
    </div>
  );
}
