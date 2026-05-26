"use client";
import { useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Tag } from "@pmplatform/ui-kit";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used?: string;
}

const SAMPLE_KEYS: ApiKey[] = [
  { id: "1", name: "CI/CD Pipeline",   prefix: "pk_ci_****",   created_at: "2026-05-01T00:00:00Z" },
  { id: "2", name: "Integration Test", prefix: "pk_test_****", created_at: "2026-05-15T00:00:00Z", last_used: "2026-05-26T07:00:00Z" },
];

export default function AdminApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>(SAMPLE_KEYS);

  function revoke(id: string) {
    setKeys((prev) => prev.filter((k) => k.id !== id));
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "API Keys" }]} />
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">API Keys</h1>
        <Button variant="primary" size="sm">Create Key</Button>
      </div>

      <div className="overflow-x-auto rounded-sm border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface text-ink-3">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Name</th>
              <th className="px-4 py-2 text-left font-medium">Key</th>
              <th className="px-4 py-2 text-left font-medium">Created</th>
              <th className="px-4 py-2 text-left font-medium">Last Used</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {keys.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-3">No API keys found.</td>
              </tr>
            ) : keys.map((k) => (
              <tr key={k.id} className="hover:bg-surface/50">
                <td className="px-4 py-2 font-medium">{k.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-3">{k.prefix}</td>
                <td className="px-4 py-2 text-ink-3">{new Date(k.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-ink-3">{k.last_used ? new Date(k.last_used).toLocaleDateString() : "Never"}</td>
                <td className="px-4 py-2">
                  <Tag tone="success" size="sm">Active</Tag>
                </td>
                <td className="px-4 py-2">
                  <Button variant="ghost" size="sm" onClick={() => revoke(k.id)}>Revoke</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
