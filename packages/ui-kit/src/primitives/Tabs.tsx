"use client";

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";

interface TabsContextValue {
  value: string;
  setValue: (next: string) => void;
  baseId: string;
}

const Ctx = createContext<TabsContextValue | null>(null);

function useTabs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("Tabs subcomponents must be rendered inside <Tabs>");
  return ctx;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Controlled active tab value */
  value?: string;
  /** Uncontrolled initial active tab */
  defaultValue?: string;
  onChange?: (next: string) => void;
  children: ReactNode;
}

export function Tabs({
  value: valueProp,
  defaultValue,
  onChange,
  children,
  className = "",
  ...rest
}: TabsProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const controlled = valueProp !== undefined;
  const value = controlled ? (valueProp as string) : uncontrolled;
  const setValue = useCallback(
    (next: string) => {
      if (!controlled) setUncontrolled(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );
  const baseId = useId();
  const ctx = useMemo(() => ({ value, setValue, baseId }), [value, setValue, baseId]);
  return (
    <Ctx.Provider value={ctx}>
      <div className={className} {...rest}>
        {children}
      </div>
    </Ctx.Provider>
  );
}

export interface TabsListProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function TabsList({ children, className = "", ...rest }: TabsListProps) {
  return (
    <div
      role="tablist"
      className={`flex items-center gap-1 border-b border-line ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export function TabsTrigger({
  value,
  children,
  disabled,
  className = "",
  onClick,
  onKeyDown,
  ...rest
}: TabsTriggerProps) {
  const { value: active, setValue, baseId } = useTabs();
  const selected = active === value;
  const triggerId = `${baseId}-trigger-${value}`;
  const panelId = `${baseId}-panel-${value}`;
  return (
    <button
      role="tab"
      id={triggerId}
      type="button"
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      disabled={disabled}
      data-state={selected ? "active" : "inactive"}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented) return;
        setValue(value);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End")
          return;
        const list = (e.currentTarget.parentElement as HTMLElement) ?? null;
        if (!list) return;
        const triggers = Array.from(
          list.querySelectorAll<HTMLButtonElement>("[role='tab']:not([disabled])"),
        );
        if (triggers.length === 0) return;
        const idx = triggers.indexOf(e.currentTarget as HTMLButtonElement);
        let nextIdx = idx;
        if (e.key === "ArrowRight") nextIdx = (idx + 1) % triggers.length;
        else if (e.key === "ArrowLeft")
          nextIdx = (idx - 1 + triggers.length) % triggers.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = triggers.length - 1;
        e.preventDefault();
        triggers[nextIdx].focus();
        triggers[nextIdx].click();
      }}
      className={`-mb-px border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none ${selected ? "border-accent text-accent" : "border-transparent text-ink-2 hover:text-ink"} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
  /** Keep panel mounted when inactive (display:none) */
  forceMount?: boolean;
}

export function TabsContent({
  value,
  forceMount,
  children,
  className = "",
  ...rest
}: TabsContentProps) {
  const { value: active, baseId } = useTabs();
  const selected = active === value;
  if (!selected && !forceMount) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-trigger-${value}`}
      hidden={!selected && forceMount ? true : undefined}
      tabIndex={0}
      className={className}
      {...rest}
    >
      {children}
    </div>
  );
}
