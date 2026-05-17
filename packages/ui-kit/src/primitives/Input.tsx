import { forwardRef, type InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", invalid, ...rest }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid ? true : undefined}
      className={`h-9 w-full rounded-sm border bg-surface px-3 text-sm text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 outline-none disabled:bg-surface-2 disabled:text-ink-3 disabled:cursor-not-allowed ${invalid ? "border-danger ring-2 ring-danger/15" : "border-line hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/15"} ${className}`}
      {...rest}
    />
  ),
);
Input.displayName = "Input";
