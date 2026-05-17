import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "signal";

const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  accent:  "bg-accent-soft text-accent",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger:  "bg-danger/10 text-danger",
  info:    "bg-info/10 text-info",
  signal:  "bg-signal-soft text-signal",
};

const toneDot: Record<Tone, string> = {
  neutral: "bg-ink-3",
  accent:  "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger:  "bg-danger",
  info:    "bg-info",
  signal:  "bg-signal",
};

export function Tag({ children, tone = "neutral", dot = false }:
  { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span className={`inline-flex h-5 items-center gap-1.5 rounded-xs px-1.5 text-[11px] font-medium tracking-wide ${toneClass[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} aria-hidden />}
      {children}
    </span>
  );
}
