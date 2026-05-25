"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import {
  listAllTasks,
  updateTask,
  type Task,
  type TaskType,
} from "@/lib/api/tasks";
import { priorityTone, statusTone, statusLabel, priorityLabel } from "@/lib/api/taskTones";
import { TaskSheet } from "@/components/TaskSheet";

// ─── Sortable row ──────────────────────────────────────────────────────────────

function BacklogRow({ task, onOpen }: { task: Task; onOpen: (t: Task) => void }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 border-b border-line bg-paper px-3 py-2 text-sm
        hover:bg-surface-2 cursor-pointer select-none
        ${isDragging ? "opacity-50 shadow-pop z-50 relative" : ""}`}
      onClick={() => onOpen(task)}
    >
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label="Drag to reorder"
        className="text-ink-3 hover:text-ink cursor-grab active:cursor-grabbing p-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </button>
      <span className="font-mono text-[10px] text-ink-3 w-20 shrink-0 truncate">{task.code}</span>
      <span className="flex-1 truncate text-sm text-ink">{task.title}</span>
      <Tag tone={priorityTone(task.priority)} size="sm">{priorityLabel(task.priority)}</Tag>
      <Tag tone={statusTone(task.status)} size="sm">{statusLabel(task.status)}</Tag>
      <span className="font-mono text-[10px] text-ink-3 w-12 text-right shrink-0">{task.estimateMd}d</span>
    </div>
  );
}

// ─── Type filter options ───────────────────────────────────────────────────────

const TYPE_FILTERS: Array<{ value: TaskType | ""; label: string }> = [
  { value: "",           label: "All"  },
  { value: "task",       label: "Task" },
  { value: "bug",        label: "Bug"  },
  { value: "risk",       label: "Risk" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BacklogPage() {
  const qc = useQueryClient();
  const [search, setSearch]         = useState("");
  const [typeFilter, setTypeFilter] = useState<TaskType | "">("");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [localOrder, setLocalOrder] = useState<Task[]>([]);

  const { data: fetchResult, isLoading, refetch } = useQuery({
    queryKey: ["backlog-tasks"],
    queryFn: () => listAllTasks({ limit: 200 }),
  });

  const tasks = fetchResult?.items ?? [];

  useEffect(() => {
    if (tasks.length > 0) {
      setLocalOrder([...tasks].sort((a, b) => a.sortOrder - b.sortOrder));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchResult]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const reorderMutation = useMutation({
    mutationFn: ({ id, sortOrder, version }: { id: string; sortOrder: number; version: number }) =>
      updateTask(id, { sort_order: sortOrder, version }),
  });

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setLocalOrder((prev) => {
        const oldIndex = prev.findIndex((t) => t.id === active.id);
        const newIndex = prev.findIndex((t) => t.id === over.id);
        if (oldIndex === -1 || newIndex === -1) return prev;
        const reordered = arrayMove(prev, oldIndex, newIndex);
        // Persist new sort_order values (multiply by 10 for spacing)
        reordered.forEach((t, i) => {
          const newOrder = i * 10;
          if (t.sortOrder !== newOrder) {
            reorderMutation.mutate({ id: t.id, sortOrder: newOrder, version: t.version });
          }
        });
        return reordered;
      });
    },
    [reorderMutation],
  );

  const filtered = localOrder.filter((t) => {
    if (typeFilter && t.type !== typeFilter) return false;
    if (
      search &&
      !t.title.toLowerCase().includes(search.toLowerCase()) &&
      !t.code.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Breadcrumb items={[{ label: "PM Hub", href: "/pm/home" }, { label: "Backlog" }]} />
      <CommandBar
        actions={[
          {
            id: "refresh",
            label: "Refresh",
            icon: <RefreshCw size={14} />,
            onClick: () => { void refetch(); },
          },
        ]}
      />

      {/* Filters */}
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-paper px-4 py-2">
        <Input
          placeholder="Search title or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56"
        />
        <div className="flex gap-1">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setTypeFilter(f.value as TaskType | "")}
              className={`rounded-xs px-2.5 py-1 text-[11px] font-medium transition-colors
                ${typeFilter === f.value
                  ? "bg-accent text-paper"
                  : "bg-surface-2 text-ink-2 hover:text-ink border border-line"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-[11px] text-ink-3">{filtered.length} items</span>
      </div>

      {/* Column header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        <span className="w-5" />
        <span className="w-20">Code</span>
        <span className="flex-1">Title</span>
        <span className="w-16">Priority</span>
        <span className="w-20">Status</span>
        <span className="w-12 text-right">Est.</span>
      </div>

      {/* List */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="animate-pulse space-y-px">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-10 border-b border-line bg-surface-2" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-ink-3">
            <p className="text-sm">No backlog items match your filters.</p>
            {(search || typeFilter) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setSearch(""); setTypeFilter(""); }}
              >
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filtered.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {filtered.map((task) => (
                <BacklogRow
                  key={task.id}
                  task={task}
                  onOpen={(t) => setSelectedTaskId(t.id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Task Sheet */}
      {selectedTaskId && (
        <TaskSheet
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ["backlog-tasks"] });
            setSelectedTaskId(null);
          }}
        />
      )}
    </div>
  );
}
