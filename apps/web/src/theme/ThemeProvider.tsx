"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Density } from "./density";

type Theme = "light" | "dark" | "hc";

interface Ctx {
  theme: Theme; setTheme: (t: Theme) => void;
  density: Density; setDensity: (d: Density) => void;
}

const ThemeCtx = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [density, setDensity] = useState<Density>("cozy");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = density;
  }, [theme, density]);

  return <ThemeCtx.Provider value={{ theme, setTheme, density, setDensity }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("ThemeProvider missing");
  return v;
}
