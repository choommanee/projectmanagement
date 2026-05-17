export const tokens = {
  color: {
    primary: "#0B5CFF",
    primaryHover: "#0A53E5",
    bg: "#FFFFFF",
    bgMuted: "#F6F7F9",
    fg: "#0B0C0F",
    fgMuted: "#5C6470",
    border: "#E3E6EB",
    success: "#127C4D",
    warning: "#B5701C",
    danger: "#C0303C",
    info: "#0B5CFF",
  },
  spacing: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px" },
  radius: { sm: "4px", md: "6px", lg: "10px" },
  typography: {
    fontFamily: {
      sans: "'Inter', system-ui, sans-serif",
      mono: "'JetBrains Mono', ui-monospace, monospace",
    },
    fontSize: { xs: "12px", sm: "13px", md: "14px", lg: "16px", xl: "20px", "2xl": "28px" },
  },
  density: { compact: 4, cozy: 8, comfortable: 12 } as const,
} as const;

export type Tokens = typeof tokens;
