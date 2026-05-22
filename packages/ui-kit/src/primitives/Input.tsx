import { forwardRef, type InputHTMLAttributes } from "react";

type Size = "sm" | "md";

const sizeClass: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[13px]",
  md: "h-9 px-3 text-sm",
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  invalid?: boolean;
  size?: Size;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", invalid, size = "md", ...rest }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid ? true : undefined}
      className={`w-full rounded-sm border bg-surface text-ink placeholder:text-ink-3 transition-[border-color,box-shadow] duration-150 outline-none disabled:bg-surface-2 disabled:text-ink-3 disabled:cursor-not-allowed ${sizeClass[size]} ${invalid ? "border-danger ring-2 ring-danger/15" : "border-line hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/15"} ${className}`}
      {...rest}
    />
  ),
);
Input.displayName = "Input";
