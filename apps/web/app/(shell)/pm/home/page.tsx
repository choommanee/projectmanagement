"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Plus,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import { Button } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { useAuth } from "@/lib/auth/AuthProvider";
import { listProjects, type Project } from "@/lib/api/projects";
import { listAllTasks, type Task } from "@/lib/api/tasks";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function fmtDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function relTime(iso: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function isOverdue(task: Task): boolean {
  if (!task.dueDate) return false;
  return new Date(task.dueDate) < new Date() && task.status !== "done" && task.status !== "cancelled";
}

function statusLabel(s: Task["status"]): string {
  const map: Record<string, string> = {
    todo: "Todo",
    in_progress: "In Progress",
    blocked: "Blocked",
    review: "Review",
    done: "Done",
    cancelled: "Cancelled",
  };
  return map[s] ?? s;
}

function statusDot(s: Task["status"]): string {
  switch (s) {
    case "done": return "bg-success";
    case "in_progress": return "bg-accent";
    case "blocked": return "bg-danger";
    case "review": return "bg-warning";
    default: return "bg-ink-3";
  }
}

function priorityBadge(p: Task["priority"]): string {
  switch (p) {
    case "critical": return "text-danger border-danger/30 bg-danger/5";
    case "high": return "text-warning border-warning/30 bg-warning/5";
    case "med": return "text-ink-2 border-line bg-surface-2";
    default: return "text-ink-3 border-line bg-surface";
  }
}

function projectStatusColor(s: Project["status"]): string {
  switch (s) {
    case "active": return "bg-success";
    case "on_hold": return "bg-warning";
    case "completed": return "bg-ink-3";
    case "cancelled": return "bg-danger";
    default: return "bg-ink-3";
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub?: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}) {
  const toneMap: Record<string, string> = {
    neutral: "border-line bg-surface text-ink",
    success: "border-success/25 bg-success/5 text-success",
    warning: "border-warning/25 bg-warning/5 text-warning",
    danger:  "border-danger/25  bg-danger/5  text-danger",
    accent:  "border-accent/25  bg-accent/5  text-accent",
  };
  const iconTone: Record<string, string> = {
    neutral: "text-ink-3",
    success: "text-success/70",
    warning: "text-warning/70",
    danger:  "text-danger/70",
    accent:  "text-accent/70",
  };
  return (
    <div className={`flex flex-col gap-2 rounded-md border px-4 py-3 ${toneMap[tone]}`}>
      <div className={`${iconTone[tone]}`}>{icon}</div>
      <div>
        <div className="font-mono text-2xl tabular-nums leading-none">{value}</div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] opacity-60">{label}</div>
        {sub && <div className="mt-0.5 text-[10px] opacity-50">{sub}</div>}
      </div>
    </div>
  );
}

function TaskRow({ task, onClick }: { task: Task; onClick: () => void }) {
  const overdue = isOverdue(task);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
    >
      <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${statusDot(task.status)}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{task.title}</span>
          <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${priorityBadge(task.priority)}`}>
            {task.priority}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
          <span className="font-mono">{task.code}</span>
          {task.dueDate && (
            <span className={overdue ? "font-medium text-danger" : ""}>
              {overdue ? "⚠ " : ""}due {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
          <span className="ml-auto shrink-0">{statusLabel(task.status)}</span>
        </div>
      </div>
    </button>
  );
}

function ProjectCard({ project, onClick }: { project: Project; onClick: () => void }) {
  const pct = Math.min(100, Math.max(0, project.progressPct ?? 0));
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-md border border-line bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex-1 truncate font-medium text-ink">{project.name}</span>
        <span className="flex items-center gap-1 shrink-0">
          <span className={`h-1.5 w-1.5 rounded-full ${projectStatusColor(project.status)}`} />
          <span className="font-mono text-[10px] text-ink-3 capitalize">{project.status.replace("_", " ")}</span>
        </span>
      </div>
      {project.description && (
        <p className="line-clamp-1 text-[11px] text-ink-3">{project.description}</p>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] text-ink-3">
          <span>Progress</span>
          <span className="font-mono tabular-nums">{pct}%</span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          {/* eslint-disable-next-line react/forbid-dom-props */}
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="text-[10px] text-ink-3">Updated {relTime(project.updatedAt)}</div>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PMHome() {
  const router = useRouter();
  const { user } = useAuth();

  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [counts, setCounts] = useState({ total: 0, inProgress: 0, overdue: 0, done: 0, blocked: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [myTasksRes, allActive, allDone, allBlocked, projectsRes] = await Promise.all([
        user?.id
          ? listAllTasks({ assignee: user.id, limit: 50 })
          : Promise.resolve({ items: [], total: 0 }),
        listAllTasks({ status: "in_progress", limit: 1 }),
        listAllTasks({ status: "done", limit: 1 }),
        listAllTasks({ status: "blocked", limit: 1 }),
        listProjects({ limit: 20, status: "active" }),
      ]);

      const myActive = myTasksRes.items.filter(
        (t) => t.status !== "done" && t.status !== "cancelled"
      );
      const overdueCount = myTasksRes.items.filter(isOverdue).length;

      setMyTasks(myActive.slice(0, 8));
      setProjects(projectsRes.items.slice(0, 6));
      setCounts({
        total: myActive.length,
        inProgress: allActive.total,
        overdue: overdueCount,
        done: allDone.total,
        blocked: allBlocked.total,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const completionPct =
    counts.inProgress + counts.done > 0
      ? Math.round((counts.done / (counts.inProgress + counts.done)) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <Breadcrumb items={[{ label: "PM Hub", href: "/pm/home" }, { label: "Home" }]} />

      {/* ── Hero header ─────────────────────────────────────────── */}
      <div className="border-b border-line bg-linear-to-r from-surface-2 via-paper to-paper px-6 py-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{fmtDate()}</p>
            <h1 className="mt-1 text-2xl font-semibold text-ink">
              {greeting()}{user?.displayName ? `, ${user.displayName}` : ""}
            </h1>
            <p className="mt-0.5 text-sm text-ink-3">
              {counts.total > 0
                ? `You have ${counts.total} active task${counts.total !== 1 ? "s" : ""}${counts.overdue > 0 ? ` · ${counts.overdue} overdue` : ""}`
                : "No active tasks — you're all caught up!"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => router.push("/pm/projects")}
            >
              <Plus size={13} className="mr-1" />
              New Project
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={load}
            >
              <RefreshCw size={13} className="mr-1" />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6">
        {error && (
          <div className="mb-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
            {error}
          </div>
        )}

        {/* ── Overdue alert ────────────────────────────────────────── */}
        {!loading && counts.overdue > 0 && (
          <div className="mb-4 flex items-center gap-3 rounded-md border border-danger/30 bg-danger/5 px-4 py-3">
            <AlertCircle size={16} className="shrink-0 text-danger" />
            <p className="flex-1 text-sm text-danger">
              <span className="font-semibold">{counts.overdue} overdue task{counts.overdue !== 1 ? "s" : ""}</span>
              {" — "}deadline{counts.overdue !== 1 ? "s" : ""} passed without completion.
            </p>
            <button
              type="button"
              onClick={() => router.push("/pm/tasks")}
              className="shrink-0 text-[11px] font-medium text-danger underline underline-offset-2 hover:opacity-80"
            >
              View overdue →
            </button>
          </div>
        )}

        {/* ── KPI strip ───────────────────────────────────────────── */}
        {loading ? (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-md border border-line bg-surface-2" />
            ))}
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              icon={<ListTodo size={16} />}
              label="My Active Tasks"
              value={counts.total}
              tone={counts.total > 0 ? "accent" : "neutral"}
            />
            <KpiCard
              icon={<TrendingUp size={16} />}
              label="In Progress"
              value={counts.inProgress}
              tone="accent"
            />
            <KpiCard
              icon={<AlertCircle size={16} />}
              label="Overdue"
              value={counts.overdue}
              tone={counts.overdue > 0 ? "danger" : "neutral"}
              sub={counts.overdue > 0 ? "needs attention" : "all on time"}
            />
            <KpiCard
              icon={<CheckCircle2 size={16} />}
              label="Completion"
              value={`${completionPct}%`}
              tone={completionPct >= 80 ? "success" : completionPct >= 50 ? "warning" : "neutral"}
              sub={`${counts.done} tasks done`}
            />
          </div>
        )}

        {/* ── Main two-column ──────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

          {/* My Tasks */}
          <div className="flex flex-col overflow-hidden rounded-md border border-line bg-paper">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <ListTodo size={14} className="text-ink-3" />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3">
                  My Tasks
                </span>
                {counts.total > 0 && (
                  <span className="rounded-full bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-accent">
                    {counts.total}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => router.push("/pm/tasks")}
                className="text-[11px] text-ink-3 underline-offset-2 hover:text-accent hover:underline"
              >
                View all →
              </button>
            </div>

            {loading ? (
              <div className="space-y-px p-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
                ))}
              </div>
            ) : myTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <CheckCircle2 size={28} className="text-success/50" />
                <p className="text-sm font-medium text-ink-2">All caught up!</p>
                <p className="text-[11px] text-ink-3">No active tasks assigned to you</p>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {myTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onClick={() => router.push(`/pm/tasks/${task.id}`)}
                  />
                ))}
                {counts.total > 8 && (
                  <button
                    type="button"
                    onClick={() => router.push("/pm/tasks")}
                    className="w-full px-4 py-2.5 text-center text-[11px] text-ink-3 hover:bg-surface-2 hover:text-accent"
                  >
                    +{counts.total - 8} more tasks →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Active Projects */}
          <div className="flex flex-col overflow-hidden rounded-md border border-line bg-paper">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <FolderKanban size={14} className="text-ink-3" />
                <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3">
                  Active Projects
                </span>
              </div>
              <button
                type="button"
                onClick={() => router.push("/pm/projects")}
                className="text-[11px] text-ink-3 underline-offset-2 hover:text-accent hover:underline"
              >
                View all →
              </button>
            </div>

            {loading ? (
              <div className="space-y-2 p-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-md border border-line bg-surface-2" />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <FolderKanban size={28} className="text-ink-3/40" />
                <p className="text-sm font-medium text-ink-2">No active projects</p>
                <button
                  type="button"
                  onClick={() => router.push("/pm/projects")}
                  className="mt-1 text-[11px] text-accent underline-offset-2 hover:underline"
                >
                  Create your first project →
                </button>
              </div>
            ) : (
              <div className="space-y-2 p-3">
                {projects.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    onClick={() => router.push(`/pm/projects/${p.id}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Quick actions row ────────────────────────────────────── */}
        <div className="mt-6 flex flex-wrap gap-2">
          <p className="w-full font-mono text-[9px] font-semibold uppercase tracking-widest text-ink-3">
            Quick Actions
          </p>
          {[
            { label: "Backlog", icon: <LayoutDashboard size={12} />, href: "/pm/backlog" },
            { label: "My Tasks (Inbox)", icon: <ListTodo size={12} />, href: "/pm/inbox" },
            { label: "Timesheet", icon: <Clock size={12} />, href: "/pm/timesheet" },
            { label: "Workflows", icon: <TrendingUp size={12} />, href: "/pm/workflows" },
          ].map((a) => (
            <button
              key={a.href}
              type="button"
              onClick={() => router.push(a.href)}
              className="flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
