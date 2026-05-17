"use client";
import { useState, useRef, useEffect } from "react";
import { Settings, Search, Menu, ChevronDown, LogOut, User as UserIcon } from "lucide-react";
import { Button } from "@pmplatform/ui-kit";
import type { AppDef } from "./shell.types";
import { AppSwitcher } from "./AppSwitcher";
import { NotificationCenter } from "./NotificationCenter";
import { mockNotifications } from "@/lib/mock/notifications";
import { useAuth } from "@/lib/auth/AuthProvider";
import Link from "next/link";

interface AppMeta { id: string; name: string }

export function TopBar({
  app, apps = [], onAppSwitch,
}: {
  app: AppDef;
  apps?: AppMeta[];
  onAppSwitch?: (id: string) => void;
}) {
  const { user, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  const displayName = user?.displayName ?? "Demo User";
  const tenantSlug = user?.tenantSlug ?? "acme";
  const email = user?.email ?? "";
  const avatarLetter = displayName.charAt(0).toUpperCase();

  return (
    <header className="flex h-12 items-center gap-3 border-b border-border bg-bg px-3">
      <Button variant="ghost" size="sm" aria-label="Toggle nav"><Menu size={16} /></Button>
      <AppSwitcher
        current={app.id}
        apps={apps.length > 0 ? apps : [{ id: app.id, name: app.name }]}
        onSelect={onAppSwitch ?? (() => {})}
      />
      <div className="ml-4 flex max-w-md flex-1 items-center gap-2 rounded-md bg-bgMuted px-2 py-1 text-sm text-fgMuted">
        <Search size={14} /><input className="flex-1 bg-transparent outline-none" placeholder="Search" />
      </div>
      <div className="ml-auto flex items-center gap-1">
        <NotificationCenter items={mockNotifications} />
        <Button variant="ghost" size="sm" aria-label="Settings"><Settings size={16} /></Button>

        {/* User dropdown */}
        <div className="relative ml-1" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-bgMuted"
            aria-haspopup="true"
            aria-expanded={dropdownOpen ? "true" : "false"}
          >
            <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs text-white">
              {avatarLetter}
            </span>
            <span>{displayName}</span>
            <span className="text-xs text-fgMuted">{tenantSlug}</span>
            <ChevronDown size={12} className="text-fgMuted" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-bg shadow-md">
              {/* User info header */}
              <div className="border-b border-border px-3 py-2">
                <p className="text-sm font-medium">{displayName}</p>
                {email && <p className="text-xs text-fgMuted">{email}</p>}
                <p className="text-xs text-fgMuted">{tenantSlug}</p>
              </div>

              {/* Menu items */}
              <div className="py-1">
                <Link
                  href="/profile"
                  onClick={() => setDropdownOpen(false)}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-bgMuted"
                >
                  <UserIcon size={14} />
                  Profile
                </Link>
                <button
                  type="button"
                  onClick={async () => {
                    setDropdownOpen(false);
                    await signOut();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger/10"
                >
                  <LogOut size={14} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
