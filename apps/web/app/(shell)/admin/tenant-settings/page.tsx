"use client";
import { useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Input } from "@pmplatform/ui-kit";

export default function TenantSettingsPage() {
  const [name, setName]         = useState("Demo Tenant");
  const [locale, setLocale]     = useState("en");
  const [timezone, setTimezone] = useState("Asia/Bangkok");
  const [saved, setSaved]       = useState(false);

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Tenant Settings" }]} />
      <h1 className="text-xl font-semibold">Tenant Settings</h1>

      <form onSubmit={handleSave} className="flex flex-col gap-4 max-w-md">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Tenant Display Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Locale</span>
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            className="rounded-sm border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="en">English</option>
            <option value="th">Thai</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Timezone</span>
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </label>
        <Button type="submit" variant="primary" size="sm">
          {saved ? "Saved!" : "Save Settings"}
        </Button>
      </form>
    </div>
  );
}
