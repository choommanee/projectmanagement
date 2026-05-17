import { Breadcrumb } from "@/shell/Breadcrumb";
import { ComingSoon } from "@/shell/ComingSoon";
import { Factory } from "lucide-react";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "MRP" }]} />
      <ComingSoon title="MRP" description="Net requirements + pegging + action messages" icon={Factory} plan="Page #9" />
    </div>
  );
}
