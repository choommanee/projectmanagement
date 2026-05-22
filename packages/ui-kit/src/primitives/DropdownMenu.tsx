"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: (next: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  contentRef: React.RefObject<HTMLDivElement | null>;
  menuId: string;
  triggerId: string;
}

const Ctx = createContext<DropdownMenuContextValue | null>(null);

function useDropdownMenu() {
  const ctx = useContext(Ctx);
  if (!ctx)
    throw new Error("DropdownMenu subcomponents must be rendered inside <DropdownMenu>");
  return ctx;
}

export interface DropdownMenuProps {
  children: ReactNode;
  /** Controlled open */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  defaultOpen?: boolean;
}

export function DropdownMenu({
  children,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
}: DropdownMenuProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? !!openProp : uncontrolled;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!controlled) setUncontrolled(next);
      onOpenChange?.(next);
    },
    [controlled, onOpenChange],
  );

  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const menuId = `dm-menu-${reactId}`;
  const triggerId = `dm-trigger-${reactId}`;

  // Click outside
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        contentRef.current?.contains(t)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, setOpen]);

  // Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const value = useMemo(
    () => ({ open, setOpen, triggerRef, contentRef, menuId, triggerId }),
    [open, setOpen, menuId, triggerId],
  );

  return (
    <Ctx.Provider value={value}>
      <span className="relative inline-block">{children}</span>
    </Ctx.Provider>
  );
}

export interface DropdownMenuTriggerProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export function DropdownMenuTrigger({
  children,
  onClick,
  className = "",
  ...rest
}: DropdownMenuTriggerProps) {
  const { open, setOpen, triggerRef, menuId, triggerId } = useDropdownMenu();
  return (
    <button
      ref={triggerRef}
      id={triggerId}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        setOpen(!open);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setOpen(true);
          // focus first item after open
          window.setTimeout(() => {
            const root = document.getElementById(menuId);
            const first = root?.querySelector<HTMLElement>(
              "[role='menuitem']:not([aria-disabled='true'])",
            );
            first?.focus();
          }, 0);
        }
      }}
      className={className}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface DropdownMenuContentProps
  extends HTMLAttributes<HTMLDivElement> {
  align?: "start" | "end";
  /** Distance in px from trigger */
  sideOffset?: number;
}

export function DropdownMenuContent({
  children,
  className = "",
  align = "start",
  sideOffset = 4,
  ...rest
}: DropdownMenuContentProps) {
  const { open, contentRef, menuId, triggerId } = useDropdownMenu();
  if (!open) return null;
  return (
    <div
      ref={contentRef}
      id={menuId}
      role="menu"
      aria-labelledby={triggerId}
      tabIndex={-1}
      style={{ top: `calc(100% + ${sideOffset}px)` }}
      className={`absolute z-40 min-w-[10rem] rounded-sm border border-line-strong bg-surface py-1 shadow-pop ${align === "end" ? "right-0" : "left-0"} ${className}`}
      onKeyDown={(e) => {
        const items = Array.from(
          (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
            "[role='menuitem']:not([aria-disabled='true'])",
          ),
        );
        if (items.length === 0) return;
        const active = document.activeElement as HTMLElement | null;
        const idx = active ? items.indexOf(active) : -1;
        if (e.key === "ArrowDown") {
          e.preventDefault();
          items[(idx + 1) % items.length].focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          items[(idx - 1 + items.length) % items.length].focus();
        } else if (e.key === "Home") {
          e.preventDefault();
          items[0].focus();
        } else if (e.key === "End") {
          e.preventDefault();
          items[items.length - 1].focus();
        }
      }}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface DropdownMenuItemProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onSelect"> {
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export function DropdownMenuItem({
  children,
  onSelect,
  disabled,
  destructive,
  className = "",
  onClick,
  onKeyDown,
  ...rest
}: DropdownMenuItemProps) {
  const { setOpen } = useDropdownMenu();
  const fire = () => {
    if (disabled) return;
    onSelect?.();
    setOpen(false);
  };
  return (
    <button
      role="menuitem"
      type="button"
      aria-disabled={disabled || undefined}
      disabled={disabled}
      tabIndex={-1}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] outline-none disabled:opacity-50 disabled:cursor-not-allowed ${destructive ? "text-danger hover:bg-danger/10 focus:bg-danger/10" : "text-ink hover:bg-surface-2 focus:bg-surface-2"} ${className}`}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        fire();
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fire();
        }
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

export function DropdownMenuSeparator({
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="separator"
      className={`my-1 h-px bg-line ${className}`}
      {...rest}
    />
  );
}
