"use client";
import { useState } from "react";
import { Breadcrumb } from "@/shell/Breadcrumb";
import { Button, Tag } from "@pmplatform/ui-kit";

interface Integration {
  id: string;
  name: string;
  desc: string;
  enabled: boolean;
  category: string;
}

const INTEGRATIONS: Integration[] = [
  { id: "slack",       name: "Slack",           desc: "Send notifications to Slack channels.",    enabled: false, category: "Notifications" },
  { id: "teams",       name: "Microsoft Teams", desc: "Send notifications to Teams channels.",   enabled: false, category: "Notifications" },
  { id: "smtp",        name: "SMTP Email",      desc: "Send transactional emails via SMTP.",     enabled: true,  category: "Notifications" },
  { id: "s3",          name: "S3 / MinIO",      desc: "Object storage for attachments.",         enabled: true,  category: "Storage"       },
  { id: "meilisearch", name: "Meilisearch",     desc: "Full-text search across entities.",       enabled: true,  category: "Search"        },
];

export default function AdminIntegrationsPage() {
  const [integrations, setIntegrations] = useState(INTEGRATIONS);

  function toggle(id: string) {
    setIntegrations((prev) =>
      prev.map((i) => (i.id === id ? { ...i, enabled: !i.enabled } : i))
    );
  }

  const categories = [...new Set(integrations.map((i) => i.category))];

  return (
    <div className="flex flex-col gap-4 p-6">
      <Breadcrumb items={[{ label: "Admin", href: "/admin/home" }, { label: "Integrations" }]} />
      <h1 className="text-xl font-semibold">Integrations</h1>

      {categories.map((cat) => (
        <div key={cat}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-ink-3">{cat}</h2>
          <div className="flex flex-col gap-2">
            {integrations
              .filter((i) => i.category === cat)
              .map((i) => (
                <div
                  key={i.id}
                  className="flex items-center justify-between rounded-sm border border-line bg-surface p-4"
                >
                  <div>
                    <p className="text-sm font-medium">{i.name}</p>
                    <p className="mt-0.5 text-xs text-ink-3">{i.desc}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Tag tone={i.enabled ? "success" : "neutral"} size="sm">
                      {i.enabled ? "Enabled" : "Disabled"}
                    </Tag>
                    <Button variant="ghost" size="sm" onClick={() => toggle(i.id)}>
                      {i.enabled ? "Disable" : "Enable"}
                    </Button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
