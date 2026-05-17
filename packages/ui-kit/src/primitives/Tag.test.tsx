import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Tag } from "./Tag";

describe("Tag", () => {
  it("renders children", () => {
    render(<Tag>Active</Tag>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
  it("renders dot when prop set", () => {
    const { container } = render(<Tag dot>Active</Tag>);
    expect(container.querySelectorAll("span")[1]).toBeTruthy();
  });
  it("applies tone class", () => {
    render(<Tag tone="signal">Hot</Tag>);
    const el = screen.getByText("Hot");
    expect(el.className).toContain("text-signal");
  });
});
