import { forwardRef, type SelectHTMLAttributes } from "react";

type Size = "sm" | "md";

const sizeClass: Record<Size, string> = {
  sm: "h-8 pl-2.5 pr-7 text-[13px]",
  md: "h-9 pl-3 pr-8 text-sm",
};

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "onChange" | "value"> {
  value?: string;
  onChange?: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  size?: Size;
  invalid?: boolean;
}

/**
 * Industrial-instrument Select primitive.
 * Wraps a native <select> styled to match Input — zero-dep, accessible by default.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className = "",
      value,
      onChange,
      options,
      placeholder,
      size = "md",
      invalid,
      disabled,
      ...rest
    },
    ref,
  ) => (
    <span className="relative inline-block w-full">
      <select
        ref={ref}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        aria-invalid={invalid ? true : undefined}
        disabled={disabled}
        className={`w-full appearance-none rounded-sm border bg-surface text-ink transition-[border-color,box-shadow] duration-150 outline-none disabled:bg-surface-2 disabled:text-ink-3 disabled:cursor-not-allowed ${sizeClass[size]} ${invalid ? "border-danger ring-2 ring-danger/15" : "border-line hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/15"} ${className}`}
        {...rest}
      >
        {placeholder !== undefined && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        ))}
      </select>
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-3"
      >
        <svg
          width="10"
          height="6"
          viewBox="0 0 10 6"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M1 1L5 5L9 1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </span>
  ),
);
Select.displayName = "Select";
