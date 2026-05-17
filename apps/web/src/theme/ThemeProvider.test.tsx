import { describe, it, expect } from "vitest";
import { render, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ThemeProvider, useTheme } from "./ThemeProvider";

function Probe({ onReady }: { onReady: (api: ReturnType<typeof useTheme>) => void }) {
  const api = useTheme();
  onReady(api);
  return null;
}

describe("ThemeProvider", () => {
  it("sets data-theme on documentElement", () => {
    let api!: ReturnType<typeof useTheme>;
    render(<ThemeProvider><Probe onReady={(a) => { api = a; }} /></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => api.setTheme("dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("density default cozy and changes", () => {
    let api!: ReturnType<typeof useTheme>;
    render(<ThemeProvider><Probe onReady={(a) => { api = a; }} /></ThemeProvider>);
    expect(document.documentElement.dataset.density).toBe("cozy");
    act(() => api.setDensity("compact"));
    expect(document.documentElement.dataset.density).toBe("compact");
  });
});
