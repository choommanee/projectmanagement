import { Breadcrumb } from "@/shell/Breadcrumb";
import { ComingSoon } from "@/shell/ComingSoon";
import { ShieldCheck } from "lucide-react";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/mfg/home" }, { label: "PPAP" }]} />
      <ComingSoon title="PPAP" description="Level 1-5 submission builder" icon={ShieldCheck} plan="Page #10" />
    </div>
  );
}
