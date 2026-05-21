import type { TaskStatus, TaskPriority } from "./tasks";

export type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "signal";

export function statusTone(status: TaskStatus): Tone {
  switch (status) {
    case "todo":        return "neutral";
    case "in_progress": return "warning";
    case "blocked":     return "danger";
    case "review":      return "info";
    case "done":        return "success";
    case "cancelled":   return "neutral";
    default:            return "neutral";
  }
}

export function priorityTone(priority: TaskPriority): Tone {
  switch (priority) {
    case "low":      return "neutral";
    case "med":      return "info";
    case "high":     return "warning";
    case "critical": return "signal";
    default:         return "neutral";
  }
}

export function statusLabel(status: TaskStatus): string {
  switch (status) {
    case "todo":        return "Todo";
    case "in_progress": return "In Progress";
    case "blocked":     return "Blocked";
    case "review":      return "Review";
    case "done":        return "Done";
    case "cancelled":   return "Cancelled";
    default:            return status;
  }
}

export function priorityLabel(priority: TaskPriority): string {
  switch (priority) {
    case "low":      return "Low";
    case "med":      return "Med";
    case "high":     return "High";
    case "critical": return "Critical";
    default:         return priority;
  }
}

/**
 * Static class lookups for Tailwind JIT.
 * NEVER build class strings as `bg-${tone}` — Tailwind cannot statically extract
 * dynamic class names, so the colors may be purged from the production bundle.
 */
const TONE_BG: Record<Tone, string> = {
  neutral: "bg-ink-3",
  success: "bg-success",
  warning: "bg-warning",
  danger:  "bg-danger",
  info:    "bg-info",
  signal:  "bg-signal",
};

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink-3",
  success: "text-success",
  warning: "text-warning",
  danger:  "text-danger",
  info:    "text-info",
  signal:  "text-signal",
};

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-line-strong",
  success: "border-success/40",
  warning: "border-warning/40",
  danger:  "border-danger/40",
  info:    "border-info/40",
  signal:  "border-signal/40",
};

export function toneBg(tone: Tone): string {
  return TONE_BG[tone];
}
export function toneText(tone: Tone): string {
  return TONE_TEXT[tone];
}
export function toneBorder(tone: Tone): string {
  return TONE_BORDER[tone];
}
