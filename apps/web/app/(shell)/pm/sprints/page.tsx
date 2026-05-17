import { Breadcrumb } from "@/shell/Breadcrumb";
import { ComingSoon } from "@/shell/ComingSoon";
import { Timer } from "lucide-react";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Sprints" }]} />
      <ComingSoon title="Sprints" description="Sprint planning + Kanban + burndown view" icon={Timer} plan="Plan #5: PM UI" />
    </div>
  );
}
