export type Task = {
  id: string; project: string; title: string;
  type: "task" | "bug" | "milestone";
  status: "open" | "in_progress" | "done";
  assignee: string; estimateMd: number; actualMd: number; due: string;
};

export const mockTasks: Task[] = [
  { id: "T-1001", project: "p-001", title: "Spec API contracts",          type: "task",      status: "done",        assignee: "Alice", estimateMd: 2,  actualMd: 2.5, due: "2026-05-12" },
  { id: "T-1002", project: "p-001", title: "Schema migration plan",       type: "task",      status: "in_progress", assignee: "Bob",   estimateMd: 3,  actualMd: 1,   due: "2026-05-22" },
  { id: "T-1003", project: "p-001", title: "Cutover dry-run",             type: "milestone", status: "open",        assignee: "Alice", estimateMd: 0,  actualMd: 0,   due: "2026-06-15" },
  { id: "T-1004", project: "p-002", title: "Map Atlas fields → ERP",      type: "task",      status: "open",        assignee: "Carol", estimateMd: 5,  actualMd: 0,   due: "2026-05-30" },
  { id: "T-1005", project: "p-002", title: "OAuth client setup bug",      type: "bug",       status: "in_progress", assignee: "Bob",   estimateMd: 1,  actualMd: 0.5, due: "2026-05-20" },
  { id: "T-1006", project: "p-004", title: "iOS push notification flow",  type: "task",      status: "done",        assignee: "Dan",   estimateMd: 4,  actualMd: 3,   due: "2026-05-10" },
  { id: "T-1007", project: "p-006", title: "OPC-UA gateway prototype",    type: "task",      status: "in_progress", assignee: "Frank", estimateMd: 8,  actualMd: 5,   due: "2026-06-01" },
];

export function findTask(id: string) { return mockTasks.find((t) => t.id === id); }
