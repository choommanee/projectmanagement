"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type DialogSize = "sm" | "md" | "lg" | "xl";

const sizeClass: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
};

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: DialogSize;
  /** Prevent closing on backdrop click (still allows ESC unless dismissable=false) */
  dismissOnBackdrop?: boolean;
  /** Disable both ESC and backdrop close — for destructive flows that must be explicit */
  dismissable?: boolean;
  /** Accessible label override when no `title` is provided */
  ariaLabel?: string;
  className?: string;
}

/**
 * Industrial-instrument Dialog primitive.
 * - Portals to document.body
 * - ESC closes (unless dismissable=false)
 * - Backdrop click closes (unless dismissOnBackdrop=false)
 * - Focus is moved into the dialog on open; first interactive element gets focus
 * - Background scroll locked while open
 * - role=dialog + aria-modal + labelled by `title` (or `ariaLabel`)
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissOnBackdrop = true,
  dismissable = true,
  ariaLabel,
  className = "",
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<HTMLElement | null>(null);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // ESC handler + focus management
  useEffect(() => {
    if (!open) return;
    lastActiveRef.current = document.activeElement as HTMLElement | null;

    // Defer focus until portal mounts
    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(
        "[autofocus], [data-autofocus], button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      (first ?? panel).focus();
    }, 0);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKey);
      lastActiveRef.current?.focus?.();
    };
  }, [open, onClose, dismissable]);

  if (!open || typeof document === "undefined") return null;

  const labelled = typeof title === "string" ? title : ariaLabel ?? "Dialog";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-dialog-fade"
      role="presentation"
      onMouseDown={(e) => {
        if (!dismissable || !dismissOnBackdrop) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Scrim */}
      <div
        aria-hidden
        className="absolute inset-0 bg-ink/45 backdrop-blur-[2px]"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelled}
        tabIndex={-1}
        className={`relative w-full ${sizeClass[size]} max-h-[88vh] overflow-hidden rounded-lg border border-line-strong bg-surface shadow-pop animate-dialog-pop focus:outline-none ${className}`}
      >
        {/* Corner ticks — instrument-panel detail */}
        <span aria-hidden className="pointer-events-none absolute left-2 top-2 h-2 w-2 border-l-2 border-t-2 border-accent" />
        <span aria-hidden className="pointer-events-none absolute right-2 top-2 h-2 w-2 border-r-2 border-t-2 border-accent" />
        <span aria-hidden className="pointer-events-none absolute bottom-2 left-2 h-2 w-2 border-b-2 border-l-2 border-line-strong" />
        <span aria-hidden className="pointer-events-none absolute bottom-2 right-2 h-2 w-2 border-b-2 border-r-2 border-line-strong" />

        {(title || description) && (
          <div className="border-b border-line px-5 pb-3 pt-4">
            {title && (
              <h2 className="text-[15px] font-semibold leading-tight text-ink">
                {title}
              </h2>
            )}
            {description && (
              <div className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
                {description}
              </div>
            )}
          </div>
        )}

        <div className="max-h-[calc(88vh-9rem)] overflow-auto px-5 py-4">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-paper px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
