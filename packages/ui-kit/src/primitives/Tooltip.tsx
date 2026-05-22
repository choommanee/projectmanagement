"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /** Element receiving focus/hover. Must be a single ReactElement that forwards ref + handlers. */
  children: ReactElement;
  /** Content shown in the tooltip. */
  content: ReactNode;
  side?: TooltipSide;
  /** Open delay in ms (default 250). */
  delayDuration?: number;
  /** Distance from anchor (default 6). */
  sideOffset?: number;
  /** Disable the tooltip entirely. */
  disabled?: boolean;
}

function isCoarsePointer() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/**
 * Industrial-instrument Tooltip.
 * - Renders via portal to document.body
 * - Hover + focus reveal; ESC dismisses
 * - Skipped automatically on coarse-pointer (touch) devices
 */
export function Tooltip({
  children,
  content,
  side = "top",
  delayDuration = 250,
  sideOffset = 6,
  disabled,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const tooltipId = useId();
  const skip = disabled || isCoarsePointer();

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const computePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tip = tooltipRef.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let top = 0;
    let left = 0;
    switch (side) {
      case "top":
        top = a.top - t.height - sideOffset;
        left = a.left + a.width / 2 - t.width / 2;
        break;
      case "bottom":
        top = a.bottom + sideOffset;
        left = a.left + a.width / 2 - t.width / 2;
        break;
      case "left":
        top = a.top + a.height / 2 - t.height / 2;
        left = a.left - t.width - sideOffset;
        break;
      case "right":
        top = a.top + a.height / 2 - t.height / 2;
        left = a.right + sideOffset;
        break;
    }
    setCoords({ top: top + window.scrollY, left: left + window.scrollX });
  }, [side, sideOffset]);

  useEffect(() => {
    if (!open) return;
    // Position after mount so we can measure
    const raf = window.requestAnimationFrame(computePosition);
    const onResize = () => computePosition();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, computePosition]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  if (!isValidElement(children)) return children as unknown as ReactElement;
  if (skip) return children;

  const requestOpen = () => {
    clearTimer();
    timerRef.current = window.setTimeout(() => setOpen(true), delayDuration);
  };
  const requestClose = () => {
    clearTimer();
    setOpen(false);
  };

  const childProps = (children.props ?? {}) as Record<string, unknown>;
  const merged = {
    ref: (node: HTMLElement | null) => {
      anchorRef.current = node;
      const cref = (children as unknown as { ref?: unknown }).ref;
      if (typeof cref === "function") (cref as (n: HTMLElement | null) => void)(node);
      else if (cref && typeof cref === "object" && "current" in (cref as object)) {
        (cref as { current: HTMLElement | null }).current = node;
      }
    },
    onMouseEnter: (e: React.MouseEvent) => {
      (childProps.onMouseEnter as ((e: React.MouseEvent) => void) | undefined)?.(e);
      requestOpen();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      (childProps.onMouseLeave as ((e: React.MouseEvent) => void) | undefined)?.(e);
      requestClose();
    },
    onFocus: (e: React.FocusEvent) => {
      (childProps.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(e);
      // focus shows immediately (no delay) for keyboard parity
      clearTimer();
      setOpen(true);
    },
    onBlur: (e: React.FocusEvent) => {
      (childProps.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(e);
      requestClose();
    },
    "aria-describedby": open
      ? [(childProps as { ["aria-describedby"]?: string })["aria-describedby"], tooltipId]
          .filter(Boolean)
          .join(" ")
      : (childProps as { ["aria-describedby"]?: string })["aria-describedby"],
  } as Record<string, unknown>;

  const anchor = cloneElement(children, merged);

  return (
    <>
      {anchor}
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={tooltipRef}
              role="tooltip"
              id={tooltipId}
              style={{
                position: "absolute",
                top: coords?.top ?? -9999,
                left: coords?.left ?? -9999,
                visibility: coords ? "visible" : "hidden",
                pointerEvents: "none",
              }}
              className="z-50 max-w-xs rounded-sm border border-line-strong bg-ink px-2 py-1 text-[11.5px] leading-snug text-white shadow-pop"
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
