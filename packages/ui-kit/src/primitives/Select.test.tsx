import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Select } from "./Select";

const options = [
  { label: "Apple", value: "apple" },
  { label: "Banana", value: "banana" },
  { label: "Cherry", value: "cherry", disabled: true },
];

describe("Select", () => {
  it("renders all options + placeholder", () => {
    render(<Select options={options} placeholder="Pick one" />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Apple" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Banana" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cherry" })).toBeDisabled();
  });

  it("calls onChange with the selected value", () => {
    const onChange = vi.fn();
    render(<Select options={options} value="apple" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "banana" } });
    expect(onChange).toHaveBeenCalledWith("banana");
  });

  it("marks invalid via aria-invalid", () => {
    render(<Select options={options} invalid />);
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-invalid", "true");
  });
});
