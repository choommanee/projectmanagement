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

type Size = "sm" | "md";

const sizeClass: Record<Size, string> = {
  sm: "h-4 px-1 text-[10px]",
  md: "h-5 px-1.5 text-[11px]",
};

export function Tag({ children, tone = "neutral", size = "md", dot = false }:
  { children: ReactNode; tone?: Tone; size?: Size; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-xs font-medium tracking-wide ${sizeClass[size]} ${toneClass[tone]}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${toneDot[tone]}`} aria-hidden />}
      {children}
    </span>
  );
}
