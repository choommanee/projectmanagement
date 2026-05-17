import { Breadcrumb } from "@/shell/Breadcrumb";
import { ComingSoon } from "@/shell/ComingSoon";
import { Workflow } from "lucide-react";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Workflows" }]} />
      <ComingSoon title="Workflow Studio" description="Visual workflow designer + run history" icon={Workflow} plan="Page #12" />
    </div>
  );
}
