"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BurndownChart } from "@/components/BurndownChart";
import { VelocityChart } from "@/components/VelocityChart";
import { useParams, useRouter } from "next/navigation";
import {
  DndContext,
  closestCorners,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import { Edit2, Play, XCircle, RefreshCw, Plus, Check, X } from "lucide-react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { CommandBar } from "@/shell/CommandBar";
import { Button, Tag } from "@pmplatform/ui-kit";
import { TaskSheet } from "@/components/TaskSheet";
import {
  getSprint,
  updateSprint,
  assignTaskToSprint,
  unassignTaskFromSprint,
  listSprintTasks,
  listSprintsForProject,
  type Sprint,
  type SprintStatus,
} from "@/lib/api/sprints";
import { listTasksForProject, updateTask, getTask, type Task, type TaskStatus } from "@/lib/api/tasks";
import { statusTone, statusLabel, priorityTone, priorityLabel, toneBg } from "@/lib/api/taskTones";

// ── Constants ───────────────────────────────────────────────────────────────

const SPRINT_COLS: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "blocked", label: "Blocked" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];
const BACKLOG_COL_ID = "__backlog__";

const STATUS_TONE: Record<SprintStatus, "info" | "success" | "neutral"> = {
  planning: "info",
  active: "success",
  closed: "neutral",
};
const STATUS_LABEL: Record<SprintStatus, string> = {
  planning: "Planning",
  active: "Active",
  closed: "Closed",
};

function fmtDate(d?: string | null) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name.slice(0, 2).toUpperCase();
}

// ── Task Card ───────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: Task;
  isDragging?: boolean;
  onClick?: () => void;
}

function TaskCard({ task, isDragging, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, isDragging: localDragging } = useDraggable({ id: task.id });

  const isGhost = isDragging !== undefined ? isDragging : localDragging;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      className={`group flex min-h-12 items-center gap-2 rounded-xs border border-line bg-paper px-2 py-1.5 cursor-grab active:cursor-grabbing transition-all select-none
        hover:shadow-sm hover:border-line-strong
        ${isGhost ? "opacity-40 shadow-none" : "shadow-xs"}`}
    >
      <span className="font-mono text-[10px] text-ink-3 shrink-0 w-14 truncate">{task.code}</span>
      <span className="flex-1 text-xs text-ink truncate leading-tight">{task.title}</span>
      <span className={`w-2 h-2 rounded-full shrink-0 ${toneBg(priorityTone(task.priority))}`} title={priorityLabel(task.priority)} />
      {task.assigneeId && (
        <span className="w-5 h-5 rounded-full bg-accent-soft text-[9px] font-medium text-accent flex items-center justify-center shrink-0" title={task.assigneeId}>
          {initials(task.assigneeId.slice(0, 4))}
        </span>
      )}
      {task.estimateMd > 0 && (
        <span className="font-mono text-[10px] text-ink-3 shrink-0">{task.estimateMd}d</span>
      )}
    </div>
  );
}

// Overlay card (shown while dragging)
function TaskCardOverlay({ task }: { task: Task }) {
  return (
    <div className="flex min-h-12 w-60 items-center gap-2 rounded-xs border border-accent bg-paper px-2 py-1.5 shadow-pop rotate-1 opacity-90">
      <span className="font-mono text-[10px] text-ink-3 shrink-0 w-14 truncate">{task.code}</span>
      <span className="flex-1 text-xs text-ink truncate leading-tight">{task.title}</span>
      <span className={`w-2 h-2 rounded-full shrink-0 ${toneBg(priorityTone(task.priority))}`} />
    </div>
  );
}

// ── Kanban Column ────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  id: string;
  label: string;
  tasks: Task[];
  isBacklog?: boolean;
  onCardClick: (task: Task) => void;
}

function KanbanColumn({ id, label, tasks, isBacklog, onCardClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-sm border transition-all w-55 min-w-55 min-h-120 max-h-[calc(100vh-260px)]
        ${isOver
          ? "border-accent ring-2 ring-accent ring-offset-2 bg-accent-soft/20"
          : "border-line bg-surface-2/40"
        }`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-line shrink-0">
        <span className="text-xs font-semibold text-ink-2">{label}</span>
        <span className="text-[10px] font-mono bg-surface px-1.5 py-0.5 rounded-xs text-ink-3 border border-line">{tasks.length}</span>
      </div>

      {/* Backlog notice */}
      {isBacklog && (
        <div className="px-3 pt-2 pb-0">
          <p className="text-[10px] text-ink-3 italic">Tasks not in this sprint. Drag to assign.</p>
        </div>
      )}

      {/* Task list */}
      <div className="flex flex-col gap-1.5 p-2 overflow-y-auto flex-1">
        {tasks.length === 0 && (
          <div className="flex items-center justify-center h-16 text-[10px] text-ink-3 opacity-60">
            {isBacklog ? "No backlog tasks" : "Drop here"}
          </div>
        )}
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} onClick={() => onCardClick(t)} />
        ))}
      </div>
    </div>
  );
}

// ── Edit Sprint Dialog ───────────────────────────────────────────────────────

interface EditSprintDialogProps {
  sprint: Sprint;
  onClose: () => void;
  onSaved: (sp: Sprint) => void;
}

function EditSprintDialog({ sprint, onClose, onSaved }: EditSprintDialogProps) {
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal);
  const [startDate, setStartDate] = useState(sprint.startDate?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = useState(sprint.endDate?.slice(0, 10) ?? "");
  const [capacityPts, setCapacityPts] = useState(String(sprint.capacityPts));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Name is required"); return; }
    setLoading(true);
    setError("");
    try {
      // Always send goal/dates — the backend treats "" as an explicit clear,
      // while omitting the field leaves the old value in place.
      const updated = await updateSprint(sprint.id, {
        name: name.trim(),
        goal: goal.trim(),
        start_date: startDate,
        end_date: endDate,
        capacity_pts: capacityPts ? Number(capacityPts) : undefined,
        version: sprint.version,
      });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update sprint");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-md bg-paper shadow-pop border border-line p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-ink mb-4">Edit Sprint</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="edit-sprint-name" className="text-xs font-medium text-ink-2 mb-1 block">Sprint name *</label>
            <input
              id="edit-sprint-name"
              className="w-full rounded-xs border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="edit-sprint-goal" className="text-xs font-medium text-ink-2 mb-1 block">Goal</label>
            <input
              id="edit-sprint-goal"
              className="w-full rounded-xs border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="Sprint goal…"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="edit-sprint-start" className="text-xs font-medium text-ink-2 mb-1 block">Start date</label>
              <input id="edit-sprint-start" aria-label="Start date" type="date" className="w-full rounded-xs border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="edit-sprint-end" className="text-xs font-medium text-ink-2 mb-1 block">End date</label>
              <input id="edit-sprint-end" aria-label="End date" type="date" className="w-full rounded-xs border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="edit-sprint-capacity" className="text-xs font-medium text-ink-2 mb-1 block">Capacity (story points)</label>
            <input
              id="edit-sprint-capacity"
              aria-label="Capacity in story points"
              type="number"
              min="0"
              className="w-full rounded-xs border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              value={capacityPts}
              onChange={(e) => setCapacityPts(e.target.value)}
              placeholder="40"
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" size="sm" disabled={loading}>
              {loading ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Task Picker Dialog (add tasks to sprint from backlog) ────────────────────

interface TaskPickerDialogProps {
  backlogTasks: Task[];
  sprintId: string;
  onClose: () => void;
  onAssigned: () => void;
}

function TaskPickerDialog({ backlogTasks, sprintId, onClose, onAssigned }: TaskPickerDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAssign() {
    if (selected.size === 0) return;
    setLoading(true);
    setError("");
    try {
      await Promise.all([...selected].map((tid) => assignTaskToSprint(sprintId, tid)));
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign tasks");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-md bg-paper shadow-pop border border-line p-6 flex flex-col max-h-[70vh]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-ink mb-3">Add tasks to sprint</h2>
        {backlogTasks.length === 0 ? (
          <p className="text-sm text-ink-3 py-8 text-center">No backlog tasks available.</p>
        ) : (
          <div className="overflow-y-auto flex-1 flex flex-col gap-1 mb-4">
            {backlogTasks.map((t) => (
              <label
                key={t.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-xs cursor-pointer border transition-colors
                  ${selected.has(t.id) ? "border-accent bg-accent-soft/20" : "border-line hover:bg-surface"}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Select task ${t.code}: ${t.title}`}
                  className="accent-accent"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                />
                <span className="font-mono text-[10px] text-ink-3 w-16 truncate shrink-0">{t.code}</span>
                <span className="flex-1 text-sm text-ink truncate">{t.title}</span>
                <Tag tone={statusTone(t.status)}>{statusLabel(t.status)}</Tag>
              </label>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-danger mb-2">{error}</p>}
        <div className="flex justify-between items-center">
          <span className="text-xs text-ink-3">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAssign} disabled={selected.size === 0 || loading}>
              {loading ? "Assigning…" : `Add ${selected.size > 0 ? `(${selected.size})` : ""} to sprint`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Close Sprint Confirm ─────────────────────────────────────────────────────

interface CloseSprintDialogProps {
  sprint: Sprint;
  sprintTasks: Task[];
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}

function CloseSprintDialog({ sprint, sprintTasks, onClose, onConfirm, loading }: CloseSprintDialogProps) {
  const done = sprintTasks.filter((t) => t.status === "done").length;
  const total = sprintTasks.length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-md bg-paper shadow-pop border border-line p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-ink mb-3">Close Sprint "{sprint.name}"?</h2>
        <div className="rounded-xs bg-surface border border-line p-3 mb-4 text-sm text-ink-2">
          <p>{done} / {total} tasks completed ({total > 0 ? Math.round((done / total) * 100) : 0}%)</p>
          {total - done > 0 && (
            <p className="mt-1 text-xs text-warning">{total - done} incomplete tasks will remain in the project backlog.</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={loading}>
            {loading ? "Closing…" : "Close Sprint"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function SprintDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sprintId = params.id as string;

  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [sprintTasks, setSprintTasks] = useState<Task[]>([]);
  const [projectTasks, setProjectTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dragError, setDragError] = useState("");

  const [chartTab, setChartTab] = useState<"burndown" | "velocity">("burndown");
  const [activeDragTask, setActiveDragTask] = useState<Task | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [statusChanging, setStatusChanging] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Fetch all sprints for the same project (used by VelocityChart)
  const { data: allSprints } = useQuery({
    queryKey: ["sprints-for-project", sprint?.projectId],
    queryFn: () => (sprint ? listSprintsForProject(sprint.projectId) : Promise.resolve([])),
    enabled: !!sprint?.projectId,
  });

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sp = await getSprint(sprintId);
      setSprint(sp);
      const [st, pt] = await Promise.all([
        listSprintTasks(sprintId),
        listTasksForProject(sp.projectId, { limit: 200 }),
      ]);
      setSprintTasks(st);
      setProjectTasks(pt.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sprint");
    } finally {
      setLoading(false);
    }
  }, [sprintId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Compute backlog: project tasks NOT in this sprint
  const sprintTaskIds = new Set(sprintTasks.map((t) => t.id));
  const backlogTasks = projectTasks.filter(
    (t) => !sprintTaskIds.has(t.id) && t.status !== "done" && t.status !== "cancelled",
  );

  // Group sprint tasks by status
  const columnTasks: Record<string, Task[]> = {};
  for (const col of SPRINT_COLS) columnTasks[col.id] = [];
  for (const t of sprintTasks) {
    if (columnTasks[t.status]) columnTasks[t.status].push(t);
    else columnTasks["todo"].push(t);
  }

  function findTask(id: string): Task | undefined {
    return sprintTasks.find((t) => t.id === id) ?? backlogTasks.find((t) => t.id === id);
  }

  function findColumn(taskId: string): string {
    if (backlogTasks.find((t) => t.id === taskId)) return BACKLOG_COL_ID;
    const t = sprintTasks.find((x) => x.id === taskId);
    return t?.status ?? BACKLOG_COL_ID;
  }

  function handleDragStart(event: DragStartEvent) {
    const task = findTask(String(event.active.id));
    if (task) setActiveDragTask(task);
    setDragError("");
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDragTask(null);
    const taskId = String(event.active.id);
    const overId = event.over?.id ? String(event.over.id) : null;
    if (!overId) return;

    const fromCol = findColumn(taskId);
    const toCol = overId;
    if (fromCol === toCol) return;

    const task = findTask(taskId);
    if (!task) return;

    const isFromBacklog = fromCol === BACKLOG_COL_ID;
    const isToBacklog = toCol === BACKLOG_COL_ID;

    // Optimistic update
    if (isFromBacklog && !isToBacklog) {
      // Backlog → sprint column
      const newStatus = toCol as TaskStatus;
      const newTask = { ...task, status: newStatus };
      setProjectTasks((prev) => prev.filter((t) => t.id !== taskId));
      setSprintTasks((prev) => [...prev, newTask]);
    } else if (!isFromBacklog && isToBacklog) {
      // Sprint column → backlog
      setSprintTasks((prev) => prev.filter((t) => t.id !== taskId));
      setProjectTasks((prev) => [...prev, task]);
    } else if (!isFromBacklog && !isToBacklog) {
      // Sprint column → different sprint column
      const newStatus = toCol as TaskStatus;
      setSprintTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, status: newStatus } : t));
    }

    // Persist
    try {
      if (isFromBacklog && !isToBacklog) {
        await assignTaskToSprint(sprintId, taskId);
        const refreshed = await getTask(taskId);
        const newStatus = toCol as TaskStatus;
        await updateTask(taskId, { status: newStatus, version: refreshed.version });
      } else if (!isFromBacklog && isToBacklog) {
        await unassignTaskFromSprint(sprintId, taskId);
      } else if (!isFromBacklog && !isToBacklog) {
        const newStatus = toCol as TaskStatus;
        const updated = await updateTask(taskId, { status: newStatus, version: task.version });
        setSprintTasks((prev) => prev.map((t) => t.id === taskId ? updated : t));
      }
    } catch (err) {
      // Rollback
      setDragError(err instanceof Error ? err.message : "Failed to move task");
      await loadAll();
    }
  }

  async function handleStatusChange(newStatus: SprintStatus) {
    if (!sprint) return;
    setStatusChanging(true);
    try {
      const updated = await updateSprint(sprint.id, { status: newStatus, version: sprint.version });
      setSprint(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setStatusChanging(false);
    }
  }

  async function handleStartSprint() {
    await handleStatusChange("active");
  }

  async function handleCloseSprint() {
    if (!sprint) return;
    setStatusChanging(true);
    try {
      const updated = await updateSprint(sprint.id, { status: "closed", version: sprint.version });
      setSprint(updated);
      setShowClose(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close sprint");
    } finally {
      setStatusChanging(false);
    }
  }

  const commandActions = [
    {
      id: "edit",
      label: "Edit",
      icon: <Edit2 size={14} />,
      onClick: () => setShowEdit(true),
      disabled: !sprint,
    },
    ...(sprint?.status === "planning" ? [{
      id: "start",
      label: "Start Sprint",
      icon: <Play size={14} />,
      variant: "primary" as const,
      onClick: handleStartSprint,
      disabled: statusChanging,
    }] : []),
    ...(sprint?.status === "active" ? [{
      id: "close",
      label: "Close Sprint",
      icon: <XCircle size={14} />,
      variant: "danger" as const,
      onClick: () => setShowClose(true),
      disabled: statusChanging,
    }] : []),
    { kind: "separator" as const, id: "sep1" },
    {
      id: "refresh",
      label: "Refresh",
      icon: <RefreshCw size={14} />,
      onClick: loadAll,
    },
  ];

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Sprints", href: "/pm/sprints" }, { label: "Loading…" }]} />
        <div className="flex flex-1 items-center justify-center text-ink-3 text-sm">Loading sprint…</div>
      </div>
    );
  }

  if (error && !sprint) {
    return (
      <div className="flex h-full flex-col">
        <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Sprints", href: "/pm/sprints" }, { label: "Error" }]} />
        <div className="flex flex-1 items-center justify-center flex-col gap-2">
          <p className="text-danger text-sm">{error}</p>
          <Button variant="ghost" size="sm" onClick={loadAll}>Try again</Button>
        </div>
      </div>
    );
  }

  const sp = sprint!;
  const startFmt = fmtDate(sp.startDate);
  const endFmt = fmtDate(sp.endDate);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Breadcrumb items={[
        { label: "Home", href: "/pm/home" },
        { label: "Sprints", href: "/pm/sprints" },
        { label: sp.name },
      ]} />
      <CommandBar actions={commandActions} />

      {/* Sprint header card */}
      <div className="shrink-0 px-4 pt-3 pb-2 border-b border-line bg-paper">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-ink truncate">{sp.name}</h1>
              {/* Inline status picker */}
              <StatusPicker sprint={sp} onStatusChange={handleStatusChange} disabled={statusChanging} />
            </div>
            {sp.goal && <p className="text-xs text-ink-3 truncate">{sp.goal}</p>}
            <div className="flex items-center gap-3 text-xs text-ink-3">
              {startFmt && endFmt && <span>{startFmt} → {endFmt}</span>}
              {sp.capacityPts > 0 && <span className="font-mono">{sp.capacityPts} pts capacity</span>}
            </div>
          </div>
          <div className="text-xs text-ink-3 text-right shrink-0">
            <div>{sprintTasks.length} tasks in sprint</div>
            <div className="text-ink-3 mt-0.5">{backlogTasks.length} in backlog</div>
          </div>
        </div>

        {sprint && (
          <div className="mt-2">
            {/* Chart tabs */}
            <div className="flex border-b border-line mb-2">
              {(["burndown", "velocity"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setChartTab(tab)}
                  className={`px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] border-b-2 transition-colors
                    ${chartTab === tab
                      ? "border-accent text-ink"
                      : "border-transparent text-ink-3 hover:text-ink-2"}`}
                >
                  {tab === "burndown" ? "Burndown" : "Velocity"}
                </button>
              ))}
            </div>
            {chartTab === "burndown" && (
              <BurndownChart sprint={sprint} tasks={sprintTasks} />
            )}
            {chartTab === "velocity" && (
              <VelocityChart
                data={(allSprints ?? [sprint]).map((s) => ({
                  sprintName: s.name,
                  // For the current sprint use the loaded task data; other sprints show 0 until loaded
                  planned: s.id === sprint.id
                    ? sprintTasks.reduce((sum, t) => sum + (t.estimateMd ?? 0), 0)
                    : 0,
                  actual: s.id === sprint.id
                    ? sprintTasks.reduce((sum, t) => sum + (t.actualMd ?? 0), 0)
                    : 0,
                }))}
              />
            )}
          </div>
        )}
      </div>

      {/* Error banner */}
      {(error || dragError) && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-danger/5 border-b border-danger/30 text-xs text-danger">
          <span className="flex-1">{dragError || error}</span>
          <button type="button" title="Dismiss" aria-label="Dismiss error" onClick={() => { setError(""); setDragError(""); }} className="opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Kanban board */}
      <div className="flex-1 overflow-auto p-4">
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 h-full items-start">
            {SPRINT_COLS.map((col) => (
              <KanbanColumn
                key={col.id}
                id={col.id}
                label={col.label}
                tasks={columnTasks[col.id] ?? []}
                onCardClick={(t) => setSelectedTaskId(t.id)}
              />
            ))}
            {/* Divider */}
            <div className="w-px self-stretch bg-line shrink-0" />
            {/* Backlog column */}
            <KanbanColumn
              id={BACKLOG_COL_ID}
              label="Backlog"
              tasks={backlogTasks}
              isBacklog
              onCardClick={(t) => setSelectedTaskId(t.id)}
            />
          </div>

          <DragOverlay>
            {activeDragTask && <TaskCardOverlay task={activeDragTask} />}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Sticky bottom-right: Add tasks button */}
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          variant="primary"
          size="sm"
          onClick={() => setShowTaskPicker(true)}
          disabled={backlogTasks.length === 0}
          className="shadow-pop"
        >
          <Plus size={14} /> Add tasks to sprint
        </Button>
      </div>

      {/* Task Sheet */}
      {selectedTaskId && (
        <TaskSheet
          taskId={selectedTaskId}
          onClose={() => setSelectedTaskId(null)}
          onChanged={() => { setSelectedTaskId(null); loadAll(); }}
        />
      )}

      {/* Edit sprint dialog */}
      {showEdit && sprint && (
        <EditSprintDialog
          sprint={sprint}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setSprint(updated); setShowEdit(false); }}
        />
      )}

      {/* Close sprint confirm */}
      {showClose && sprint && (
        <CloseSprintDialog
          sprint={sprint}
          sprintTasks={sprintTasks}
          onClose={() => setShowClose(false)}
          onConfirm={handleCloseSprint}
          loading={statusChanging}
        />
      )}

      {/* Task picker */}
      {showTaskPicker && sprint && (
        <TaskPickerDialog
          backlogTasks={backlogTasks}
          sprintId={sprint.id}
          onClose={() => setShowTaskPicker(false)}
          onAssigned={() => { setShowTaskPicker(false); loadAll(); }}
        />
      )}
    </div>
  );
}

// ── Inline status picker ─────────────────────────────────────────────────────

interface StatusPickerProps {
  sprint: Sprint;
  onStatusChange: (s: SprintStatus) => void;
  disabled: boolean;
}

function StatusPicker({ sprint, onStatusChange, disabled }: StatusPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const options: SprintStatus[] = ["planning", "active", "closed"];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="focus:outline-none"
        aria-label="Change sprint status"
        aria-expanded={open ? "true" : "false"}
        aria-haspopup="listbox"
      >
        <Tag tone={STATUS_TONE[sprint.status]}>{STATUS_LABEL[sprint.status]}</Tag>
      </button>
      {open && (
        <ul className="absolute left-0 top-full z-50 mt-1 min-w-32 rounded-sm border border-line bg-paper p-1 shadow-pop">
          {options.map((s) => (
            <li key={s}>
              <button
                type="button"
                className={`flex w-full items-center gap-2 rounded-xs px-2 py-1.5 text-xs text-ink hover:bg-surface transition-colors
                  ${s === sprint.status ? "font-medium" : ""}`}
                onClick={() => { onStatusChange(s); setOpen(false); }}
              >
                {s === sprint.status && <Check size={10} className="text-accent shrink-0" />}
                <span className={s === sprint.status ? "" : "ml-3.5"}>{STATUS_LABEL[s]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
