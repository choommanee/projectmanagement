"use client";

import { useState } from "react";
import { FolderOpen, ChevronRight, ChevronDown } from "lucide-react";
import type { Task } from "@/lib/api/tasks";

// ─── Props ────────────────────────────────────────────────────────────────────

interface WBSTreeProps {
  tasks: Task[];
  onSelectTask: (id: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: Task["status"]): string {
  switch (status) {
    case "done":        return "bg-success";
    case "in_progress": return "bg-accent";
    case "blocked":     return "bg-danger";
    case "review":      return "bg-warning";
    default:            return "bg-ink-3";
  }
}

function priorityLabel(priority: Task["priority"]): { label: string; cls: string } {
  switch (priority) {
    case "critical": return { label: "CRIT", cls: "text-danger border-danger/40" };
    case "high":     return { label: "HIGH", cls: "text-warning border-warning/40" };
    case "med":      return { label: "MED",  cls: "text-ink-2 border-line" };
    case "low":      return { label: "LOW",  cls: "text-ink-3 border-line" };
  }
}

function assigneeInitials(assigneeId: string): string {
  // Derive two-char initials from the last 6 chars of the UUID segment
  const tail = assigneeId.replace(/-/g, "").slice(-6);
  const initials: string = tail.slice(0, 1) + tail.slice(-1);
  return initials.toUpperCase();
}

function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

// ─── Row ──────────────────────────────────────────────────────────────────────

interface RowProps {
  task: Task;
  depth: number;
  wbsPrefix: string;
  childMap: Map<string, Task[]>;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelectTask: (id: string) => void;
}

function WBSRow({
  task,
  depth,
  wbsPrefix,
  childMap,
  collapsed,
  onToggle,
  onSelectTask,
}: RowProps) {
  const children = childMap.get(task.id) ?? [];
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(task.id);
  const overdue = isOverdue(task.dueDate);
  const priority = priorityLabel(task.priority);

  return (
    <>
      <tr className="group border-b border-line hover:bg-surface-2 transition-colors">
        {/* WBS + title */}
        <td className="px-2 py-1.5">
          <div
            className="flex items-center gap-1"
            style={{ paddingLeft: `${depth * 16}px` }}
          >
            {/* Collapse toggle */}
            <button
              type="button"
              aria-label={hasChildren ? (isCollapsed ? "Expand" : "Collapse") : undefined}
              onClick={() => hasChildren && onToggle(task.id)}
              className={`flex h-4 w-4 shrink-0 items-center justify-center text-ink-3 transition-colors ${
                hasChildren ? "cursor-pointer hover:text-ink" : "cursor-default"
              }`}
            >
              {hasChildren ? (
                isCollapsed ? (
                  <ChevronRight size={12} />
                ) : (
                  <ChevronDown size={12} />
                )
              ) : (
                <span className="h-1 w-1 rounded-full bg-ink-3/50" />
              )}
            </button>

            {/* WBS number */}
            <span className="mr-1.5 w-14 shrink-0 font-mono text-[11px] tabular-nums text-ink-3">
              {wbsPrefix}
            </span>

            {/* Status dot */}
            <span
              className={`mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${statusColor(task.status)}`}
            />

            {/* Title */}
            <button
              type="button"
              onClick={() => onSelectTask(task.id)}
              className="min-w-0 truncate text-left text-[13px] text-ink hover:text-accent hover:underline"
              title={task.title}
            >
              {task.title}
            </button>
          </div>
        </td>

        {/* Priority */}
        <td className="whitespace-nowrap px-2 py-1.5">
          <span
            className={`inline-block rounded-xs border px-1.5 py-0 font-mono text-[10px] leading-4 tracking-widest ${priority.cls}`}
          >
            {priority.label}
          </span>
        </td>

        {/* Due date */}
        <td className="whitespace-nowrap px-2 py-1.5">
          {task.dueDate ? (
            <span
              className={`font-mono text-[11px] tabular-nums ${
                overdue ? "text-danger" : "text-ink-3"
              }`}
            >
              {task.dueDate.slice(0, 10)}
            </span>
          ) : (
            <span className="text-[11px] text-ink-3">—</span>
          )}
        </td>

        {/* Progress */}
        <td className="px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <div className="h-1 w-15 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${task.progressPct}%` }}
              />
            </div>
            <span className="w-7 text-right font-mono text-[10px] tabular-nums text-ink-3">
              {task.progressPct}%
            </span>
          </div>
        </td>

        {/* Assignee */}
        <td className="px-2 py-1.5">
          {task.assigneeId ? (
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-xs bg-accent/10 font-mono text-[9px] font-semibold uppercase text-accent"
              title={task.assigneeId}
            >
              {assigneeInitials(task.assigneeId)}
            </span>
          ) : (
            <span className="text-[11px] text-ink-3">—</span>
          )}
        </td>
      </tr>

      {/* Recursive children */}
      {!isCollapsed &&
        children.map((child, idx) => (
          <WBSRow
            key={child.id}
            task={child}
            depth={depth + 1}
            wbsPrefix={`${wbsPrefix}.${idx + 1}`}
            childMap={childMap}
            collapsed={collapsed}
            onToggle={onToggle}
            onSelectTask={onSelectTask}
          />
        ))}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WBSTree({ tasks, onSelectTask }: WBSTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Build child map
  const childMap = new Map<string, Task[]>();
  for (const task of tasks) {
    const pid = task.parentId ?? null;
    if (pid) {
      const existing = childMap.get(pid) ?? [];
      existing.push(task);
      childMap.set(pid, existing);
    }
  }

  // Sort children by sortOrder within each parent
  childMap.forEach((children) => {
    children.sort((a, b) => a.sortOrder - b.sortOrder);
  });

  // Root tasks: no parentId, or parentId not found in task set
  const taskIds = new Set(tasks.map((t) => t.id));
  const roots = tasks
    .filter((t) => !t.parentId || !taskIds.has(t.parentId))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  function handleToggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-line px-6 py-12 text-center">
        <FolderOpen size={28} className="text-ink-3/50" />
        <p className="text-sm text-ink-3">No tasks in this project.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2 text-left text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            <th className="px-2 py-2 pl-6">WBS / Title</th>
            <th className="whitespace-nowrap px-2 py-2">Priority</th>
            <th className="whitespace-nowrap px-2 py-2">Due</th>
            <th className="px-2 py-2">Progress</th>
            <th className="px-2 py-2">Owner</th>
          </tr>
        </thead>
        <tbody>
          {roots.map((root, idx) => (
            <WBSRow
              key={root.id}
              task={root}
              depth={0}
              wbsPrefix={String(idx + 1)}
              childMap={childMap}
              collapsed={collapsed}
              onToggle={handleToggle}
              onSelectTask={onSelectTask}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
