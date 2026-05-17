import { describe, it, expect } from "vitest";
import { statusTone, priorityTone } from "./taskTones";
import type { TaskStatus, TaskPriority } from "./tasks";

describe("statusTone", () => {
  it("maps every TaskStatus enum value to the correct tone", () => {
    const cases: Array<[TaskStatus, string]> = [
      ["todo",        "neutral"],
      ["in_progress", "warning"],
      ["blocked",     "danger"],
      ["review",      "info"],
      ["done",        "success"],
      ["cancelled",   "neutral"],
    ];
    for (const [status, expectedTone] of cases) {
      expect(statusTone(status)).toBe(expectedTone);
    }
  });
});

describe("priorityTone", () => {
  it("maps every TaskPriority enum value to the correct tone", () => {
    const cases: Array<[TaskPriority, string]> = [
      ["low",      "neutral"],
      ["med",      "info"],
      ["high",     "warning"],
      ["critical", "signal"],
    ];
    for (const [priority, expectedTone] of cases) {
      expect(priorityTone(priority)).toBe(expectedTone);
    }
  });
});
