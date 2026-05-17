"use client";
import { useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";

export interface Notification { id: string; title: string; ts: string; read?: boolean }

export function NotificationCenter({ items }: { items: Notification[] }) {
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read).length;
  return (
    <div className="relative">
      <Button variant="ghost" size="sm" aria-label="Notifications" onClick={() => setOpen((v) => !v)}>
        <Bell size={16} />
        {unread > 0 && <span className="ml-1 rounded-full bg-danger px-1.5 text-[10px] text-white">{unread}</span>}
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-80 rounded-md border border-border bg-bg p-2 shadow-md">
          {items.length === 0 ? (
            <div className="p-3 text-sm text-fgMuted">All caught up.</div>
          ) : items.map((n) => (
            <div key={n.id} className={`rounded p-2 text-sm ${n.read ? "" : "bg-bgMuted"}`}>
              <div>{n.title}</div>
              <div className="text-xs text-fgMuted">{n.ts}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
