import type { ReactNode } from "react";

export interface SectionHeaderProps {
  /** Numeric or short alphanumeric code, e.g. "01", "EXEC" */
  code?: string;
  label: string;
  count?: number;
  /** Right-aligned slot (button, link, etc.) */
  action?: ReactNode;
  /** Render inline (no bottom margin) — useful when adjacent to an action row */
  inline?: boolean;
  className?: string;
}

/**
 * Editorial section header used across modules to keep info hierarchy uniform.
 *
 *   ◆ 01 / pinned   [02]                                [+ New]
 */
export function SectionHeader({
  code,
  label,
  count,
  action,
  inline,
  className = "",
}: SectionHeaderProps) {
  const heading = (
    <h2 className="flex items-baseline gap-3">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
        ◆ {code ? `${code} / ` : ""}{label}
      </span>
      {typeof count === "number" && (
        <span className="font-mono text-[10px] tabular-nums text-ink-3">
          [{String(count).padStart(2, "0")}]
        </span>
      )}
    </h2>
  );

  if (action) {
    return (
      <div className={`${inline ? "" : "mb-3"} flex items-end justify-between gap-3 ${className}`}>
        {heading}
        {action}
      </div>
    );
  }

  return <div className={inline ? className : `mb-3 ${className}`}>{heading}</div>;
}
