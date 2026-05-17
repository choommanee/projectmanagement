import { Breadcrumb } from "@/shell/Breadcrumb";
import { ComingSoon } from "@/shell/ComingSoon";
import { Lightbulb } from "lucide-react";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Expert Knowledge" }]} />
      <ComingSoon title="Expert Knowledge" description="KB + Q&A + semantic search" icon={Lightbulb} plan="Plan #7" />
    </div>
  );
}
