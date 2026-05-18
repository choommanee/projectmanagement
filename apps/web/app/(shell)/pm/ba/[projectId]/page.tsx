"use client";

import { use } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { WorkspaceShell } from "@/components/WorkspaceShell";

export default function BAWorkspacePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);

  return (
    <div className="flex h-full flex-col">
      <Breadcrumb
        items={[
          { label: "Home", href: "/pm/home" },
          { label: "BA Workspace", href: "/pm/ba" },
          { label: projectId },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkspaceShell
          projectId={projectId}
          kind="ba"
          allowedTypes={["brd", "frd", "user_story", "use_case", "process_flow", "rtm"]}
          workspaceName="BA Workspace"
        />
      </div>
    </div>
  );
}
