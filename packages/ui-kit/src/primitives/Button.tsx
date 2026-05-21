import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variantClass: Record<Variant, string> = {
  primary:   "bg-accent text-white hover:bg-accent-hover active:translate-y-px shadow-xs",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2 hover:border-line-strong shadow-xs",
  ghost:     "bg-transparent text-ink-2 hover:text-ink hover:bg-surface-2",
  danger:    "bg-danger text-white hover:brightness-95 active:translate-y-px shadow-xs",
};

const sizeClass: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
  lg: "h-10 px-4 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className = "", loading, disabled, children, type, ...rest }, ref) => (
    <button
      ref={ref}
      type={type ?? "button"}
      data-variant={variant}
      data-size={size}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center rounded-sm font-medium transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...rest}
    >
      {loading && <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
