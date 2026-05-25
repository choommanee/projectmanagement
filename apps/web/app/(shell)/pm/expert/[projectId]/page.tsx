"use client";

import { use, useEffect, useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { WorkspaceShell } from "@/components/WorkspaceShell";
import { getProject } from "@/lib/api/projects";

export default function ExpertWorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [projectName, setProjectName] = useState<string>("");

  useEffect(() => {
    getProject(projectId)
      .then(p => setProjectName(p.name))
      .catch(() => setProjectName(projectId.slice(0, 8)));
  }, [projectId]);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[
          { label: "Home", href: "/pm/home" },
          { label: "Expert Knowledge", href: "/pm/expert" },
          { label: projectName || "…" },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceShell
          projectId={projectId}
          kind="expert"
          allowedTypes={["knowledge_article", "decision_log", "qa", "lesson_learned", "expertise_profile"]}
          workspaceName="Expert Knowledge"
        />
      </div>
    </div>
  );
}
