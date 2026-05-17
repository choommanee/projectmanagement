import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppShell } from "./AppShell";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";

const app = {
  id: "pm", name: "PM Hub",
  areas: [{ id: "a1", name: "Work", groups: [{ id: "g1", name: "Mine", subareas: [{ id: "s1", name: "Tasks", href: "/pm/tasks" }] }] }],
};

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider><AuthProvider>{children}</AuthProvider></ThemeProvider>;
}

describe("AppShell", () => {
  it("renders top bar with app name", () => {
    render(<Wrapper><AppShell app={app}><div>body</div></AppShell></Wrapper>);
    expect(screen.getByText("PM Hub")).toBeInTheDocument();
  });
  it("renders nav with subareas", () => {
    render(<Wrapper><AppShell app={app}><div>body</div></AppShell></Wrapper>);
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/pm/tasks");
  });
});
