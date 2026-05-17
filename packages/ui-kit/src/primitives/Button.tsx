import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClass: Record<Variant, string> = {
  primary:   "bg-primary text-white hover:bg-primaryHover",
  secondary: "bg-bgMuted text-fg hover:bg-border",
  ghost:     "bg-transparent text-fg hover:bg-bgMuted",
  danger:    "bg-danger text-white",
};

const sizeClass: Record<Size, string> = {
  sm: "h-7 px-2 text-xs",
  md: "h-8 px-3 text-sm",
  lg: "h-10 px-4 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "secondary", size = "md", className = "", ...rest }, ref) => (
    <button
      ref={ref}
      data-variant={variant}
      data-size={size}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 ${variantClass[variant]} ${sizeClass[size]} ${className}`}
      {...rest}
    />
  ),
);
Button.displayName = "Button";
