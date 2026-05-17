import type { Notification } from "@/shell/NotificationCenter";

export const mockNotifications: Notification[] = [
  { id: "n1", title: "WO-2026-00421 is now released",              ts: "5m ago",  read: false },
  { id: "n2", title: "PPAP submission requires your approval",     ts: "1h ago",  read: false },
  { id: "n3", title: "Project Phoenix Migration is 62% complete",  ts: "2h ago",  read: true  },
];
