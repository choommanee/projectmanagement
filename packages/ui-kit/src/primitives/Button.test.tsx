import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
  it("applies variant attribute", () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("data-variant", "primary");
  });
  it("forwards disabled", () => {
    render(<Button disabled>X</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
