import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppShell } from "./AppShell";

const app = {
  id: "pm", name: "PM Hub",
  areas: [{ id: "a1", name: "Work", groups: [{ id: "g1", name: "Mine", subareas: [{ id: "s1", name: "Tasks", href: "/pm/tasks" }] }] }],
};
const user = { id: "u1", displayName: "Tester", email: "t@x.com", tenantSlug: "acme" };

describe("AppShell", () => {
  it("renders top bar with user", () => {
    render(<AppShell app={app} user={user}><div>body</div></AppShell>);
    expect(screen.getByText("PM Hub")).toBeInTheDocument();
    expect(screen.getByText(/Tester/)).toBeInTheDocument();
  });
  it("renders nav with subareas", () => {
    render(<AppShell app={app} user={user}><div>body</div></AppShell>);
    expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/pm/tasks");
  });
});
