"use client";

import { use } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { WorkspaceShell } from "@/components/WorkspaceShell";

export default function ExpertWorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[
          { label: "Home", href: "/pm/home" },
          { label: "Expert Knowledge", href: "/pm/expert" },
          { label: projectId },
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
