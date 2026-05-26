"use client";
import { useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Input } from "@pmplatform/ui-kit";

const ROLE_OPTIONS = [
  "tenant-admin",
  "project-manager",
  "mfg-operator",
  "quality-engineer",
  "workflow-author",
  "bi-author",
];

export default function AdminInvitesPage() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("project-manager");
  const [sent, setSent] = useState(false);

  function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setSent(true);
    setTimeout(() => { setSent(false); setEmail(""); }, 3000);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Invitations" }]} />
      <h1 className="text-xl font-semibold">Invite User</h1>
      <p className="text-sm text-ink-3">Send an email invitation to onboard a new user to this tenant.</p>

      <form onSubmit={handleInvite} className="flex flex-col gap-3 max-w-md">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Email address</span>
          <Input
            type="email"
            placeholder="user@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Role</span>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-sm border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="primary" size="sm">
          {sent ? "Invitation sent!" : "Send Invitation"}
        </Button>
      </form>
    </div>
  );
}
