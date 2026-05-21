import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** Optional eyebrow code shown above title — e.g. "◇ no data" */
  code?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  /** Compact density removes the dashed border / blueprint grid */
  variant?: "default" | "compact";
  className?: string;
}

/**
 * Industrial-instrument empty state.
 * Default variant shows a blueprint-grid background; compact removes it for inline empty rows.
 */
export function EmptyState({
  code,
  title,
  description,
  action,
  variant = "default",
  className = "",
}: EmptyStateProps) {
  if (variant === "compact") {
    return (
      <div className={`flex flex-col items-center gap-1 px-4 py-8 text-center ${className}`}>
        {code && (
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-3">{code}</div>
        )}
        {title && <div className="text-[13px] text-ink-3">{title}</div>}
        {description && <div className="text-[12px] text-ink-3">{description}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    );
  }

  return (
    <div className={`relative flex flex-col items-center justify-center gap-1.5 overflow-hidden rounded-lg border border-dashed border-line-strong bg-paper py-12 text-center ${className}`}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--line) 1px, transparent 1px), linear-gradient(to bottom, var(--line) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="relative flex flex-col items-center gap-2">
        {code && (
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-3">{code}</div>
        )}
        {title && <div className="text-[13.5px] text-ink-2">{title}</div>}
        {description && <div className="max-w-md text-[12px] leading-relaxed text-ink-3">{description}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
