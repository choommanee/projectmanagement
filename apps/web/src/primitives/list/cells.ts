import type { ComponentProps } from "react";
import type { Tag } from "@pmplatform/ui-kit";

type Tone = ComponentProps<typeof Tag>["tone"];

export function statusTone(value: unknown): Tone {
  const v = String(value ?? "").toLowerCase();
  const map: Record<string, Tone> = {
    open:        "info",
    planning:    "info",
    planned:     "neutral",
    active:      "success",
    in_progress: "warning",
    inprogress:  "warning",
    completed:   "success",
    done:        "success",
    closed:      "neutral",
    released:    "accent",
    suspended:   "danger",
    archived:    "neutral",
    high:        "signal",
    med:         "warning",
    medium:      "warning",
    low:         "neutral",
  };
  return map[v] ?? "neutral";
}

export function looksMono(value: unknown): boolean {
  const s = String(value ?? "");
  return /^[A-Z]{2,}-/.test(s) || /^[a-z]+-\d/.test(s);
}
