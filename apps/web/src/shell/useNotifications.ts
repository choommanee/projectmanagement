"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { listNotifications, markRead, markAllRead, type AppNotification } from "@/lib/api/notifications";

const POLL_MS = 30_000;

export function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { items: notifs } = await listNotifications({ limit: 50 });
      setItems(notifs);
    } catch {
      // swallow — notifications are non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load]);

  const handleMarkRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => n.id === id ? { ...n, readAt: new Date().toISOString() } : n));
    try { await markRead(id); } catch { void load(); }
  }, [load]);

  const handleMarkAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    try { await markAllRead(); } catch { void load(); }
  }, [load]);

  return { items, loading, markRead: handleMarkRead, markAllRead: handleMarkAllRead };
}
