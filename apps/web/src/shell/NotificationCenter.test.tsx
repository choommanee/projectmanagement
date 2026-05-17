import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NotificationCenter } from "./NotificationCenter";

describe("NotificationCenter", () => {
  it("shows unread count", () => {
    render(<NotificationCenter items={[
      { id: "1", title: "X", ts: "now" },
      { id: "2", title: "Y", ts: "now", read: true },
    ]} />);
    expect(screen.getByText("1")).toBeInTheDocument();
  });
  it("opens dropdown on click and shows items", () => {
    render(<NotificationCenter items={[{ id: "1", title: "Hello", ts: "now" }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });
});
