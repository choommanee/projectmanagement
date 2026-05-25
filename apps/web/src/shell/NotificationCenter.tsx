"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";
import type { AppNotification } from "@/lib/api/notifications";

function fmtTs(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface NotificationCenterProps {
  items: AppNotification[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export function NotificationCenter({ items, onMarkRead, onMarkAllRead }: NotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.readAt).length;
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleNotifClick(n: AppNotification) {
    if (!n.readAt) onMarkRead(n.id);
    const url = n.payload?.url as string | undefined;
    if (url) router.push(url);
  }

  return (
    <div ref={panelRef} className="relative">
      <Button variant="ghost" size="sm" aria-label="Notifications" onClick={() => setOpen((v) => !v)}>
        <Bell size={16} />
        {unread > 0 && (
          <span className="ml-1 rounded-full bg-danger px-1.5 text-[10px] text-white leading-none py-0.5">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <div className="absolute right-0 z-50 mt-1 w-88 rounded-sm border border-line bg-paper shadow-pop overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-line">
            <span className="text-xs font-semibold text-ink">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => { onMarkAllRead(); }}
                className="flex items-center gap-1 text-[10px] text-ink-3 hover:text-ink transition-colors"
                title="Mark all as read"
              >
                <CheckCheck size={11} />
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-line">
            {items.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-ink-3">All caught up.</div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  onClick={() => handleNotifClick(n)}
                  className={`group flex items-start gap-2.5 px-3 py-2.5 hover:bg-surface-2 transition-colors cursor-pointer ${
                    !n.readAt ? "bg-accent-soft/10" : ""
                  }`}
                >
                  {/* Unread dot */}
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${!n.readAt ? "bg-accent" : "bg-transparent"}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-snug ${!n.readAt ? "text-ink font-medium" : "text-ink-2"} truncate`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-[11px] text-ink-3 mt-0.5 line-clamp-2">{n.body}</p>
                    )}
                    <p className="text-[10px] text-ink-3 mt-1">{fmtTs(n.createdAt)}</p>
                  </div>
                  {!n.readAt && (
                    <button
                      type="button"
                      title="Mark as read"
                      aria-label="Mark as read"
                      onClick={(e) => { e.stopPropagation(); onMarkRead(n.id); }}
                      className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:text-accent"
                    >
                      <CheckCheck size={11} />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
