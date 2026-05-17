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
