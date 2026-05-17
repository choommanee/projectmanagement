"use client";
import { createContext, useContext, type ReactNode } from "react";

const Ctx = createContext<Record<string, unknown>>({});

export function CustomizationProvider({ overrides, children }:
  { overrides: Record<string, unknown>; children: ReactNode }) {
  return <Ctx.Provider value={overrides}>{children}</Ctx.Provider>;
}

export function useOverridesFor(key: string): unknown {
  const all = useContext(Ctx);
  return all[key];
}
