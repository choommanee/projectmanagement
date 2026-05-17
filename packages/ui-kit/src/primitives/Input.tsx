import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...rest }, ref) => (
    <input
      ref={ref}
      className={`h-8 w-full rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${className}`}
      {...rest}
    />
  ),
);
Input.displayName = "Input";
