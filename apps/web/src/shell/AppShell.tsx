"use client";
import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { NavPane } from "./NavPane";
import type { AppDef, UserCtx } from "./shell.types";

export function AppShell({
  app, user, children,
}: { app: AppDef; user: UserCtx; children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col">
      <TopBar app={app} user={user} />
      <div className="flex min-h-0 flex-1">
        <NavPane app={app} />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
