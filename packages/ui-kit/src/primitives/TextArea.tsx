import { forwardRef, type TextareaHTMLAttributes } from "react";

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = "", ...rest }, ref) => (
    <textarea
      ref={ref}
      className={`block w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 outline-none hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:bg-surface-2 disabled:text-ink-3 ${className}`}
      rows={5}
      {...rest}
    />
  ),
);
TextArea.displayName = "TextArea";
