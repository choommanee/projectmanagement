"use client";

import { use } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { WorkspaceShell } from "@/components/WorkspaceShell";

export default function SAWorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[
          { label: "Home", href: "/pm/home" },
          { label: "SA Workspace", href: "/pm/sa" },
          { label: projectId },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceShell
          projectId={projectId}
          kind="sa"
          allowedTypes={["sdd", "adr", "er_diagram", "api_spec", "sequence_diagram", "tech_stack"]}
          workspaceName="SA Workspace"
        />
      </div>
    </div>
  );
}
