import type { ReactNode } from "react";

export interface InstrumentTileProps {
  children: ReactNode;
  className?: string;
  /** Highlight tone for the left accent stripe (default none) */
  stripe?: "accent" | "signal" | "success" | "warning" | "danger" | "none";
  /** Padding density */
  density?: "tight" | "default" | "loose";
  /** Disable corner tick marks (e.g. when embedded in a tighter container) */
  noCorners?: boolean;
  /** Click handler turns the tile into a button */
  onClick?: () => void;
  /** Accessible label when interactive */
  ariaLabel?: string;
}

const stripeClass: Record<NonNullable<InstrumentTileProps["stripe"]>, string> = {
  accent: "bg-accent",
  signal: "bg-signal",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  none: "",
};

const densityClass: Record<NonNullable<InstrumentTileProps["density"]>, string> = {
  tight: "p-3",
  default: "p-4",
  loose: "p-5",
};

/**
 * Industrial-instrument card primitive — corner tick marks, optional left stripe,
 * subtle hover, focus ring. Use this as the canonical "card on dashboard" container.
 *
 * Usage:
 *   <InstrumentTile stripe="signal" onClick={open}>...</InstrumentTile>
 */
export function InstrumentTile({
  children,
  className = "",
  stripe = "none",
  density = "default",
  noCorners,
  onClick,
  ariaLabel,
}: InstrumentTileProps) {
  const Comp = onClick ? "button" : "div";
  const interactiveCls = onClick
    ? "cursor-pointer text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
    : "";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-label={onClick ? ariaLabel : undefined}
      className={`group relative flex flex-col gap-3 overflow-hidden rounded-lg border border-line-strong bg-surface ${densityClass[density]} shadow-xs ${interactiveCls} ${className}`}
    >
      {stripe !== "none" && (
        <span
          aria-hidden
          className={`absolute left-0 top-0 h-full w-[3px] ${stripeClass[stripe]}`}
        />
      )}
      {!noCorners && (
        <>
          <span aria-hidden className="pointer-events-none absolute left-2 top-2 h-1.5 w-1.5 border-l border-t border-line-strong" />
          <span aria-hidden className="pointer-events-none absolute right-2 top-2 h-1.5 w-1.5 border-r border-t border-line-strong" />
          <span aria-hidden className="pointer-events-none absolute bottom-2 left-2 h-1.5 w-1.5 border-b border-l border-line-strong" />
          <span aria-hidden className="pointer-events-none absolute bottom-2 right-2 h-1.5 w-1.5 border-b border-r border-line-strong" />
        </>
      )}
      {children}
    </Comp>
  );
}
