import { Breadcrumb } from "@/shell/Breadcrumb";
import { ComingSoon } from "@/shell/ComingSoon";
import { Layers } from "lucide-react";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "SA Workspace" }]} />
      <ComingSoon title="SA Workspace" description="SDD / ADR / ER diagrams / OpenAPI editor" icon={Layers} plan="Plan #6" />
    </div>
  );
}
