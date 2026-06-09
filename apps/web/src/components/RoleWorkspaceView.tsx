"use client";

import {
  type RoleDoc,
  type RoleKind,
  type RoleProject,
  type RoleTask,
  type RoleWorkspaceData,
  loadRoleWorkspace,
} from "@/lib/api/roleWorkspace";
import { useAuth } from "@/lib/auth/AuthProvider";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button } from "@pmplatform/ui-kit";
import {
  AlertTriangle,
  ClipboardList,
  Compass,
  FileText,
  FolderKanban,
  Layers,
  Lightbulb,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

// ─── Per-role presentation metadata ─────────────────────────────────────────────

const ROLE_META: Record<
  RoleKind,
  {
    icon: React.ReactNode;
    spotlightIcon: React.ReactNode;
    quickActions: { key: string; href: string }[];
  }
> = {
  ba: {
    icon: <Compass size={18} />,
    spotlightIcon: <ShieldAlert size={14} className="text-warning" />,
    quickActions: [
      { key: "backlog", href: "/pm/backlog" },
      { key: "tasks", href: "/pm/tasks" },
      { key: "documents", href: "/docs/home" },
      { key: "projects", href: "/pm/projects" },
    ],
  },
  sa: {
    icon: <Layers size={18} />,
    spotlightIcon: <AlertTriangle size={14} className="text-warning" />,
    quickActions: [
      { key: "tasks", href: "/pm/tasks" },
      { key: "workflows", href: "/pm/workflows" },
      { key: "documents", href: "/docs/home" },
      { key: "projects", href: "/pm/projects" },
    ],
  },
  expert: {
    icon: <Lightbulb size={18} />,
    spotlightIcon: <ClipboardList size={14} className="text-accent" />,
    quickActions: [
      { key: "inbox", href: "/pm/inbox" },
      { key: "tasks", href: "/pm/tasks" },
      { key: "documents", href: "/docs/home" },
      { key: "projects", href: "/pm/projects" },
    ],
  },
};

// ─── Small helpers ──────────────────────────────────────────────────────────────

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function isOverdue(t: RoleTask): boolean {
  if (!t.dueDate) return false;
  return new Date(t.dueDate) < new Date() && t.status !== "done" && t.status !== "cancelled";
}

function taskStatusDot(s: string): string {
  switch (s) {
    case "done":
      return "bg-success";
    case "in_progress":
      return "bg-accent";
    case "blocked":
      return "bg-danger";
    case "review":
      return "bg-warning";
    default:
      return "bg-ink-3";
  }
}

function priorityBadge(p: string): string {
  switch (p) {
    case "critical":
      return "text-danger border-danger/30 bg-danger/5";
    case "high":
      return "text-warning border-warning/30 bg-warning/5";
    case "med":
      return "text-ink-2 border-line bg-surface-2";
    default:
      return "text-ink-3 border-line bg-surface";
  }
}

function docStatusTone(s: string): string {
  switch (s) {
    case "approved":
      return "text-success border-success/30 bg-success/5";
    case "review":
      return "text-warning border-warning/30 bg-warning/5";
    case "archived":
      return "text-ink-3 border-line bg-surface-2";
    default:
      return "text-accent border-accent/30 bg-accent/5"; // draft
  }
}

function projectStatusColor(s: string): string {
  switch (s) {
    case "active":
      return "bg-success";
    case "on_hold":
      return "bg-warning";
    case "completed":
      return "bg-ink-3";
    case "cancelled":
      return "bg-danger";
    default:
      return "bg-accent"; // planning
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────────

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
    danger: "border-danger/25 bg-danger/5 text-danger",
    accent: "border-accent/25 bg-accent/5 text-accent",
  };
  const iconTone: Record<string, string> = {
    neutral: "text-ink-3",
    success: "text-success/70",
    warning: "text-warning/70",
    danger: "text-danger/70",
    accent: "text-accent/70",
  };
  return (
    <div className={`flex flex-col gap-2 rounded-md border px-4 py-3 ${toneMap[tone]}`}>
      <div className={iconTone[tone]}>{icon}</div>
      <div>
        <div className="font-mono text-2xl tabular-nums leading-none">{value}</div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] opacity-60">
          {label}
        </div>
        {sub && <div className="mt-0.5 text-[10px] opacity-50">{sub}</div>}
      </div>
    </div>
  );
}

function SectionCard({
  icon,
  title,
  count,
  onViewAll,
  viewAllLabel,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  onViewAll?: () => void;
  viewAllLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-line bg-paper">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-ink-3">{icon}</span>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-ink-3">
            {title}
          </span>
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-accent">
              {count}
            </span>
          )}
        </div>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-[11px] text-ink-3 underline-offset-2 hover:text-accent hover:underline"
          >
            {viewAllLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Main view ──────────────────────────────────────────────────────────────────

export function RoleWorkspaceView({ kind }: { kind: RoleKind }) {
  const router = useRouter();
  const { user } = useAuth();
  const t = useTranslations("roleWorkspace");
  const meta = ROLE_META[kind];

  const [data, setData] = useState<RoleWorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadRoleWorkspace(kind, user?.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const docLabel = (type: string) => {
    const key = `docType.${type}`;
    const label = t(key as never);
    return label === key ? type.replace(/_/g, " ") : label;
  };
  const taskStatusLabel = (s: string) => {
    const key = `taskStatus.${s}`;
    const label = t(key as never);
    return label === key ? s : label;
  };
  const docStatusLabel = (s: string) => {
    const key = `docStatus.${s}`;
    const label = t(key as never);
    return label === key ? s : label;
  };

  const TaskRow = ({ task }: { task: RoleTask }) => {
    const overdue = isOverdue(task);
    return (
      <button
        type="button"
        onClick={() => router.push(`/pm/tasks/${task.id}`)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
      >
        <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${taskStatusDot(task.status)}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-ink">
              {task.title || t("untitled")}
            </span>
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${priorityBadge(task.priority)}`}
            >
              {task.priority}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-3">
            <span className="font-mono">{task.code}</span>
            {task.dueDate && (
              <span className={overdue ? "font-medium text-danger" : ""}>
                {overdue ? "⚠ " : ""}
                {t("due", { date: shortDate(task.dueDate) })}
              </span>
            )}
            <span className="ml-auto shrink-0">{taskStatusLabel(task.status)}</span>
          </div>
        </div>
      </button>
    );
  };

  const DocRow = ({ doc }: { doc: RoleDoc }) => (
    <button
      type="button"
      onClick={() => router.push(`/docs/documents/${doc.id}`)}
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
    >
      <FileText size={14} className="shrink-0 text-ink-3" />
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {doc.title || t("untitled")}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-3">
          {docLabel(doc.type)}
        </span>
      </div>
      <span
        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase ${docStatusTone(doc.status)}`}
      >
        {docStatusLabel(doc.status)}
      </span>
    </button>
  );

  const ProjectCard = ({ project }: { project: RoleProject }) => {
    const pct = Math.min(100, Math.max(0, project.progressPct ?? 0));
    return (
      <button
        type="button"
        onClick={() => router.push(`/pm/${kind}/${project.id}`)}
        className="flex w-full flex-col gap-2 rounded-md border border-line bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="flex-1 truncate font-medium text-ink">{project.name}</span>
          <span className="flex shrink-0 items-center gap-1">
            <span className={`h-1.5 w-1.5 rounded-full ${projectStatusColor(project.status)}`} />
            <span className="font-mono text-[10px] capitalize text-ink-3">
              {project.status.replace("_", " ")}
            </span>
          </span>
        </div>
        {project.description && (
          <p className="line-clamp-1 text-[11px] text-ink-3">{project.description}</p>
        )}
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] text-ink-3">
            <span className="font-mono uppercase tracking-wider">{project.code}</span>
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
      </button>
    );
  };

  const kpis = data?.kpis;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <Breadcrumb
        items={[{ label: "PM Hub", href: "/pm/home" }, { label: t(`${kind}.title` as never) }]}
      />

      {/* Hero */}
      <div className="border-b border-line bg-linear-to-r from-surface-2 via-paper to-paper px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-accent">
              {meta.icon}
            </span>
            <div>
              <h1 className="text-2xl font-semibold text-ink">{t(`${kind}.title` as never)}</h1>
              <p className="mt-0.5 text-sm text-ink-3">{t(`${kind}.subtitle` as never)}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={load}>
            <RefreshCw size={13} className="mr-1" />
            {t("refresh")}
          </Button>
        </div>
      </div>

      <div className="flex-1 p-6">
        {error && (
          <div className="mb-4 rounded-md border border-danger/30 bg-danger/5 px-3 py-2 font-mono text-[11px] text-danger">
            {t("loadError")}: {error}
          </div>
        )}

        {/* KPI strip */}
        {loading ? (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-md border border-line bg-surface-2"
              />
            ))}
          </div>
        ) : (
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              icon={<ClipboardList size={16} />}
              label={t("kpi.openTasks")}
              value={kpis?.openTasks ?? 0}
              tone={(kpis?.openTasks ?? 0) > 0 ? "accent" : "neutral"}
            />
            <KpiCard
              icon={meta.spotlightIcon}
              label={t(`${kind}.spotlightKpi` as never)}
              value={kpis?.spotlight ?? 0}
              tone={
                (kpis?.spotlight ?? 0) > 0 ? (kind === "expert" ? "accent" : "warning") : "neutral"
              }
              sub={(kpis?.spotlight ?? 0) > 0 ? t("needsAttention") : t("allClear")}
            />
            <KpiCard
              icon={<FileText size={16} />}
              label={t("kpi.documents")}
              value={kpis?.docs ?? 0}
              tone="neutral"
              sub={
                data && data.docsInProgress > 0
                  ? t("docInProgress", { count: data.docsInProgress })
                  : undefined
              }
            />
            <KpiCard
              icon={<FolderKanban size={16} />}
              label={t("kpi.projects")}
              value={kpis?.projects ?? 0}
              tone="neutral"
            />
          </div>
        )}

        {/* Two-column: focus tasks + spotlight */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard
            icon={<ClipboardList size={14} />}
            title={t(`${kind}.tasksLabel` as never)}
            count={kpis?.openTasks}
            onViewAll={() => router.push("/pm/tasks")}
            viewAllLabel={t("viewAll")}
          >
            {loading ? (
              <div className="space-y-px p-2">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
                ))}
              </div>
            ) : !data || data.roleTasks.length === 0 ? (
              <EmptyBlock
                icon={<ClipboardList size={26} className="text-ink-3/40" />}
                text={t(`${kind}.tasksEmpty` as never)}
              />
            ) : (
              <div className="divide-y divide-line">
                {data.roleTasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
                {data.kpis.openTasks > data.roleTasks.length && (
                  <button
                    type="button"
                    onClick={() => router.push("/pm/tasks")}
                    className="w-full px-4 py-2.5 text-center text-[11px] text-ink-3 hover:bg-surface-2 hover:text-accent"
                  >
                    {t("moreTasks", { count: data.kpis.openTasks - data.roleTasks.length })}
                  </button>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard
            icon={meta.spotlightIcon}
            title={t(`${kind}.spotlightLabel` as never)}
            count={kpis?.spotlight}
            viewAllLabel={t("viewAll")}
          >
            {loading ? (
              <div className="space-y-px p-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
                ))}
              </div>
            ) : !data || data.spotlightTasks.length === 0 ? (
              <EmptyBlock icon={meta.spotlightIcon} text={t(`${kind}.spotlightEmpty` as never)} />
            ) : (
              <div className="divide-y divide-line">
                {data.spotlightTasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Two-column: documents + projects */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionCard
            icon={<FileText size={14} />}
            title={t("sections.documents")}
            count={kpis?.docs}
            onViewAll={() => router.push("/docs/home")}
            viewAllLabel={t("viewAll")}
          >
            {loading ? (
              <div className="space-y-px p-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-surface-2" />
                ))}
              </div>
            ) : !data || data.docs.length === 0 ? (
              <EmptyBlock
                icon={<FileText size={26} className="text-ink-3/40" />}
                text={t("empty.documents")}
              />
            ) : (
              <div className="divide-y divide-line">
                {data.docs.map((doc) => (
                  <DocRow key={doc.id} doc={doc} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            icon={<FolderKanban size={14} />}
            title={t(`${kind}.projectsLabel` as never)}
            count={kpis?.projects}
            onViewAll={() => router.push("/pm/projects")}
            viewAllLabel={t("viewAll")}
          >
            {loading ? (
              <div className="space-y-2 p-3">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-md border border-line bg-surface-2"
                  />
                ))}
              </div>
            ) : !data || data.projects.length === 0 ? (
              <EmptyBlock
                icon={<FolderKanban size={26} className="text-ink-3/40" />}
                text={t(`${kind}.projectsEmpty` as never)}
              />
            ) : (
              <div className="space-y-2 p-3">
                {data.projects.map((p) => (
                  <ProjectCard key={p.id} project={p} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Quick actions */}
        <div className="mt-6 flex flex-wrap gap-2">
          <p className="w-full font-mono text-[9px] font-semibold uppercase tracking-widest text-ink-3">
            {t("quickActions")}
          </p>
          {meta.quickActions.map((a) => (
            <button
              key={a.href}
              type="button"
              onClick={() => router.push(a.href)}
              className="flex items-center gap-1.5 rounded border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-accent/40 hover:bg-accent/5 hover:text-accent"
            >
              {t(`actions.${a.key}` as never)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyBlock({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon}
      <p className="text-[12px] text-ink-3">{text}</p>
    </div>
  );
}
