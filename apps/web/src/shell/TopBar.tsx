"use client";
import { Bell, Settings, Search, Menu } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";
import type { AppDef, UserCtx } from "./shell.types";

export function TopBar({ app, user }: { app: AppDef; user: UserCtx }) {
  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-bg px-3">
      <Button variant="ghost" size="sm" aria-label="Toggle nav"><Menu size={16} /></Button>
      <button className="flex items-center gap-1 text-sm font-medium" aria-haspopup="menu">
        {app.name} <span aria-hidden>▾</span>
      </button>
      <div className="ml-4 flex max-w-md flex-1 items-center gap-2 rounded-md bg-bgMuted px-2 py-1 text-sm text-fgMuted">
        <Search size={14} /><input className="flex-1 bg-transparent outline-none" placeholder="Search" />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="sm" aria-label="Notifications"><Bell size={16} /></Button>
        <Button variant="ghost" size="sm" aria-label="Settings"><Settings size={16} /></Button>
        <button className="ml-1 flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-bgMuted">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs text-white">
            {user.displayName.slice(0, 1)}
          </span>
          <span>{user.displayName}</span>
          <span className="text-xs text-fgMuted">{user.tenantSlug}</span>
        </button>
      </div>
    </header>
  );
}
