"use client";
import { MoreHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@pmplatform/ui-kit";

export type CommandAction =
  | { kind?: "action"; id: string; label: string; icon?: ReactNode; onClick: () => void; variant?: "primary" | "secondary" | "ghost" | "danger"; disabled?: boolean }
  | { kind: "separator"; id: string };

export function CommandBar({ actions, maxVisible = 7 }: { actions: CommandAction[]; maxVisible?: number }) {
  const visible = actions.slice(0, maxVisible);
  const overflow = actions.slice(maxVisible);
  const [open, setOpen] = useState(false);
  const t = useTranslations("shell");

  return (
    <div role="toolbar" aria-label={t("commands")}
      className="flex items-center gap-1 bg-paper px-3 py-1.5 border-b border-line shadow-[inset_0_-1px_0_var(--line)]">
      {visible.map((a) => {
        if ("kind" in a && a.kind === "separator") {
          return <span key={a.id} className="mx-1 h-4 w-px bg-line" aria-hidden />;
        }
        const action = a as Exclude<CommandAction, { kind: "separator" }>;
        return (
          <Button key={action.id} variant={action.variant ?? "ghost"} size="sm" onClick={action.onClick} disabled={action.disabled}>
            {action.icon}
            <span>{action.label}</span>
          </Button>
        );
      })}
      {overflow.length > 0 && (
        <div className="relative">
          <Button variant="ghost" size="sm" aria-label={t("more")} onClick={() => setOpen((v) => !v)}>
            <MoreHorizontal size={14} />
          </Button>
          {open && (
            <ul className="absolute right-0 top-full z-50 mt-1 min-w-44 rounded-sm border border-line bg-surface p-1 shadow-pop">
              {overflow.map((a) => {
                if ("kind" in a && a.kind === "separator") {
                  return <li key={a.id} className="my-1 border-t border-line" />;
                }
                const action = a as Exclude<CommandAction, { kind: "separator" }>;
                return (
                  <li key={action.id}>
                    <button
                      type="button"
                      className="block w-full rounded-xs px-2 py-1 text-left text-sm text-ink-2 hover:bg-surface-2 hover:text-ink"
                      onClick={() => { action.onClick(); setOpen(false); }}
                    >
                      {action.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
