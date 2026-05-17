import { Breadcrumb } from "@/shell/Breadcrumb";
import { ComingSoon } from "@/shell/ComingSoon";
import { Network } from "lucide-react";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "Traceability" }]} />
      <ComingSoon title="Traceability" description="Lot/serial genealogy graph + recall scope" icon={Network} plan="Page #11" />
    </div>
  );
}
