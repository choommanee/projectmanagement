"use client";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Tag } from "@pmplatform/ui-kit";

const SYSTEM_ROLES = [
  { name: "platform-admin",   label: "Platform Admin",   desc: "Full platform access, all tenants." },
  { name: "tenant-admin",     label: "Tenant Admin",     desc: "Full access within this tenant." },
  { name: "project-manager",  label: "Project Manager",  desc: "Manage PM projects, tasks, sprints." },
  { name: "mfg-operator",     label: "MFG Operator",     desc: "Work orders, BOM, production execution." },
  { name: "quality-engineer", label: "Quality Engineer", desc: "APQP, FMEA, NCR, inspections." },
  { name: "workflow-author",  label: "Workflow Author",  desc: "Design and publish workflow definitions." },
  { name: "bi-author",        label: "BI Author",        desc: "Create reports and dashboards." },
];

export default function AdminRolesPage() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Roles" }]} />
      <h1 className="text-xl font-semibold">System Roles</h1>
      <p className="text-sm text-ink-3">Roles are system-defined. Assign them to users from the Users page.</p>

      <div className="overflow-x-auto rounded-sm border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface text-ink-3">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Role</th>
              <th className="px-4 py-2 text-left font-medium">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {SYSTEM_ROLES.map((r) => (
              <tr key={r.name} className="hover:bg-surface/50">
                <td className="px-4 py-2">
                  <Tag tone="info" size="sm">{r.label}</Tag>
                </td>
                <td className="px-4 py-2 text-ink-3">{r.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
