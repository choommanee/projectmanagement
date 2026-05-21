import type { ReactNode } from "react";

export interface LoadingStateProps {
  /** Number of skeleton rows to render (default 3) */
  rows?: number;
  /** Variant — row for tabular shimmer, grid for card shimmer */
  variant?: "row" | "grid" | "panel";
  className?: string;
  ariaLabel?: string;
  children?: ReactNode;
}

/**
 * Industrial-instrument loading state.
 * Uses `var(--surface-2)` shimmer to stay coherent with token system.
 */
export function LoadingState({
  rows = 3,
  variant = "row",
  className = "",
  ariaLabel = "Loading",
  children,
}: LoadingStateProps) {
  if (variant === "grid") {
    return (
      <div
        role="status"
        aria-label={ariaLabel}
        aria-live="polite"
        className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${className}`}
      >
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg border border-line bg-surface-2" />
        ))}
        {children}
      </div>
    );
  }

  if (variant === "panel") {
    return (
      <div
        role="status"
        aria-label={ariaLabel}
        aria-live="polite"
        className={`h-48 animate-pulse rounded-lg border border-line bg-surface-2 ${className}`}
      />
    );
  }

  return (
    <div
      role="status"
      aria-label={ariaLabel}
      aria-live="polite"
      className={`space-y-1.5 ${className}`}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-surface-2" />
      ))}
      {children}
    </div>
  );
}
