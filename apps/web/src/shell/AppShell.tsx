"use client";
import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { NavPane } from "./NavPane";
import type { AppDef } from "./shell.types";

interface AppMeta { id: string; name: string }

export function AppShell({
  app, children, apps, onAppSwitch,
}: {
  app: AppDef;
  children: ReactNode;
  apps?: AppMeta[];
  onAppSwitch?: (id: string) => void;
}) {
  return (
    <div className="flex h-screen flex-col">
      <TopBar
        app={app}
        apps={apps}
        onAppSwitch={onAppSwitch}
      />
      <div className="flex min-h-0 flex-1">
        <NavPane app={app} />
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
