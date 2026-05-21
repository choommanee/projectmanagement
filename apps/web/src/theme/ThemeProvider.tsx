"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Density } from "./density";

type Theme = "light" | "dark" | "hc";

interface Ctx {
  theme: Theme; setTheme: (t: Theme) => void;
  density: Density; setDensity: (d: Density) => void;
  cycleTheme: () => void;
  cycleDensity: () => void;
}

const ThemeCtx = createContext<Ctx | null>(null);

const STORAGE_KEY_THEME = "pmp:theme";
const STORAGE_KEY_DENSITY = "pmp:density";

const THEMES: Theme[] = ["light", "dark", "hc"];
const DENSITIES: Density[] = ["compact", "cozy", "comfortable"];

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR uses defaults; client overrides from localStorage in effect below
  const [theme, setThemeState] = useState<Theme>("light");
  const [density, setDensityState] = useState<Density>("cozy");

  // Read persisted prefs once on mount
  useEffect(() => {
    try {
      const t = localStorage.getItem(STORAGE_KEY_THEME) as Theme | null;
      const d = localStorage.getItem(STORAGE_KEY_DENSITY) as Density | null;
      if (t && THEMES.includes(t)) setThemeState(t);
      if (d && DENSITIES.includes(d)) setDensityState(d);
    } catch {
      // ignore (private mode, etc.)
    }
  }, []);

  // Reflect to <html> + persist on every change
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.density = density;
    try {
      localStorage.setItem(STORAGE_KEY_THEME, theme);
      localStorage.setItem(STORAGE_KEY_DENSITY, density);
    } catch {
      // ignore
    }
  }, [theme, density]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const setDensity = useCallback((d: Density) => setDensityState(d), []);
  const cycleTheme = useCallback(() => {
    setThemeState((cur) => THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
  }, []);
  const cycleDensity = useCallback(() => {
    setDensityState((cur) => DENSITIES[(DENSITIES.indexOf(cur) + 1) % DENSITIES.length]);
  }, []);

  return (
    <ThemeCtx.Provider value={{ theme, setTheme, density, setDensity, cycleTheme, cycleDensity }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  const v = useContext(ThemeCtx);
  if (!v) throw new Error("ThemeProvider missing");
  return v;
}
