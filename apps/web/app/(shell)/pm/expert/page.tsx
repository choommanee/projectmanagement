"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Tag } from "@pmplatform/ui-kit";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { listProjects, type Project } from "@/lib/api/projects";

function statusTone(s: Project["status"]): "success" | "warning" | "neutral" | "signal" {
  switch (s) {
    case "active": return "success";
    case "on_hold": return "warning";
    case "completed": return "neutral";
    case "cancelled": return "signal";
    default: return "neutral";
  }
}

export default function ExpertLandingPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProjects({ limit: 50 })
      .then(({ items }) => setProjects(items))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Expert Knowledge" }]} />

      <div className="flex-1 overflow-auto p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-ink">Expert Knowledge</h1>
          <p className="mt-1 text-sm text-ink-3">KB Articles / Decision Logs / Q&A / Lessons Learned — pick a project to open its workspace.</p>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="animate-pulse rounded-md border border-line bg-surface p-4 shadow-xs">
                <div className="mb-2 h-4 w-16 rounded-xs bg-surface-2" />
                <div className="h-5 w-48 rounded-xs bg-surface-2" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-md border border-dashed border-line py-20 text-center">
            <p className="text-sm text-ink-3">No projects found.</p>
            <Button variant="primary" onClick={() => router.push("/pm/projects")}>
              <Plus size={14} /> Create a Project
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => router.push(`/pm/expert/${p.id}`)}
                className="rounded-md border border-line bg-surface p-4 shadow-xs text-left transition-shadow hover:shadow-sm hover:border-line-strong"
              >
                <span className="font-mono text-[11px] uppercase tracking-wider text-ink-3">{p.code}</span>
                <h3 className="mt-0.5 truncate text-base font-semibold text-ink">{p.name}</h3>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-[12px] text-ink-3">{p.description}</p>
                )}
                <div className="mt-3">
                  <Tag tone={statusTone(p.status)} dot>{p.status.replace("_", " ")}</Tag>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
