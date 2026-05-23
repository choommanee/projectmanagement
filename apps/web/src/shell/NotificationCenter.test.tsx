import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NotificationCenter } from "./NotificationCenter";
import type { AppNotification } from "@/lib/api/notifications";

const noop = () => {};

function makeNotif(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "1", tenantId: "t", userId: "u", kind: "test", title: "Test",
    body: "", payload: {}, readAt: null, createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("NotificationCenter", () => {
  it("shows unread count for unread items", () => {
    render(
      <NotificationCenter
        items={[makeNotif({ id: "1", readAt: null }), makeNotif({ id: "2", readAt: new Date().toISOString() })]}
        onMarkRead={noop}
        onMarkAllRead={noop}
      />,
    );
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("opens dropdown on click and shows items", () => {
    render(
      <NotificationCenter
        items={[makeNotif({ id: "1", title: "Hello" })]}
        onMarkRead={noop}
        onMarkAllRead={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("calls onMarkRead when mark-read button is clicked", () => {
    const onMarkRead = vi.fn();
    render(
      <NotificationCenter
        items={[makeNotif({ id: "n1", title: "Unread" })]}
        onMarkRead={onMarkRead}
        onMarkAllRead={noop}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
    expect(onMarkRead).toHaveBeenCalledWith("n1");
  });
});
