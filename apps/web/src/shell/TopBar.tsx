"use client";
import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, LogOut, User as UserIcon, Sun, Moon } from "lucide-react";
import { Button, Kbd } from "@pmplatform/ui-kit";
import type { AppDef } from "./shell.types";
import { AppSwitcher } from "./AppSwitcher";
import { NotificationCenter } from "./NotificationCenter";
import { mockNotifications } from "@/lib/mock/notifications";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useTheme } from "@/theme/ThemeProvider";
import Link from "next/link";

interface AppMeta { id: string; name: string }

const AVATAR_PALETTE = ["#1F4FFF", "#FF6B1F", "#0F8A4E", "#B5701C", "#7C3AED", "#0EA5E9"];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function TopBar({
  app, apps = [], onAppSwitch,
}: {
  app: AppDef;
  apps?: AppMeta[];
  onAppSwitch?: (id: string) => void;
}) {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
  const avatarLetter = displayName.charAt(0).toUpperCase();
  const bgColor = user?.id ? avatarColor(user.id) : AVATAR_PALETTE[0];

  return (
    <header className="flex h-14 items-center gap-3 border-b border-line bg-paper/95 backdrop-blur supports-backdrop-filter:bg-paper/70 px-4">
      {/* Left: logo + app switcher */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="grid h-9 w-9 place-items-center rounded-sm bg-ink text-paper font-mono text-[13px] font-semibold tracking-tight select-none">
          PM
        </div>
        <AppSwitcher
          current={app.id}
          apps={apps.length > 0 ? apps : [{ id: app.id, name: app.name }]}
          onSelect={onAppSwitch ?? (() => {})}
        />
      </div>

      {/* Center: search */}
      <div className="mx-auto flex w-105 items-center gap-2 rounded-sm bg-surface-2 border border-transparent hover:border-line h-9 px-2.5 text-sm transition-colors">
        <Search size={14} className="text-ink-3 shrink-0" />
        <input
          className="flex-1 bg-transparent text-ink placeholder:text-ink-3 outline-none"
          placeholder="Search projects, work orders, people…"
        />
        <Kbd>⌘K</Kbd>
      </div>

      {/* Right: notifications, theme toggle, user */}
      <div className="ml-auto flex items-center gap-1">
        <NotificationCenter items={mockNotifications} />

        {/* Theme toggle */}
        <Button
          variant="ghost"
          size="sm"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </Button>

        {/* User dropdown */}
        {user ? (
          <div className="relative ml-1" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex items-center gap-2 rounded-sm pl-1 pr-2 h-9 hover:bg-surface-2 transition-colors"
              aria-haspopup="true"
              aria-expanded={dropdownOpen}
            >
              <span
                className="grid h-7 w-7 place-items-center rounded-full text-white text-[11px] font-medium shrink-0 bg-[--avatar-bg]"
                // eslint-disable-next-line react/forbid-dom-props
                style={{ ["--avatar-bg" as string]: bgColor }}
              >
                {avatarLetter}
              </span>
              <span className="flex flex-col items-start">
                <span className="text-[13px] text-ink leading-tight">{displayName}</span>
                <span className="text-[11px] text-ink-3 leading-tight">{tenantSlug}</span>
              </span>
              <ChevronDown size={12} className="text-ink-3" />
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-sm border border-line bg-surface shadow-pop">
                <div className="border-b border-line px-3 py-2">
                  <p className="text-[13px] font-medium text-ink">{displayName}</p>
                  {user.email && <p className="text-[11px] text-ink-3">{user.email}</p>}
                  <p className="text-[11px] text-ink-3">{tenantSlug}</p>
                </div>
                <div className="py-1">
                  <Link
                    href="/profile"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors"
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
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger/10 transition-colors"
                  >
                    <LogOut size={14} />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Link href="/login" className="text-sm text-ink-2 hover:text-ink px-2 py-1 rounded-sm hover:bg-surface-2 transition-colors">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
