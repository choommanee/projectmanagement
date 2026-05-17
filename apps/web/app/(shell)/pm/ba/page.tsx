import { Breadcrumb } from "@/shell/Breadcrumb";
import { ComingSoon } from "@/shell/ComingSoon";
import { Compass } from "lucide-react";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "BA Workspace" }]} />
      <ComingSoon title="BA Workspace" description="BRD / FRD / User stories + RTM" icon={Compass} plan="Plan #6: Document Workspaces" />
    </div>
  );
}
