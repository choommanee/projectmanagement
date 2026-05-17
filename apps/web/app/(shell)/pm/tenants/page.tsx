import { Breadcrumb } from "@/shell/Breadcrumb";
import { ComingSoon } from "@/shell/ComingSoon";
import { Users } from "lucide-react";

export default function Page() {
  return (
    <div className="flex h-full flex-col">
      <Breadcrumb items={[{ label: "Home", href: "/pm/home" }, { label: "Tenants" }]} />
      <ComingSoon title="Tenants" description="Tenant CRUD + tier management" icon={Users} plan="Page #2 (next)" />
    </div>
  );
}
