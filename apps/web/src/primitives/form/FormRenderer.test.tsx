import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FormRenderer } from "./FormRenderer";
import type { FormDef } from "./form.types";

const def: FormDef = {
  entity: "wo",
  tabs: [{ id: "t1", label: "General", sections: [{ id: "s1", label: "Basic", fields: [
    { name: "title",  label: "Title",  kind: "text", required: true },
    { name: "qty",    label: "Qty",    kind: "number" },
    { name: "status", label: "Status", kind: "select", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }] },
  ]}]}],
  rules: [{ when: "status == 'closed'", set: [{ field: "qty", readOnly: true }] }],
};

describe("FormRenderer", () => {
  it("renders fields", () => {
    render(<FormRenderer def={def} value={{}} onChange={() => {}} />);
    expect(screen.getByText("Title *")).toBeInTheDocument();
    expect(screen.getByText("Qty")).toBeInTheDocument();
  });
  it("applies business rule (Qty readOnly when status=closed)", () => {
    const { rerender } = render(<FormRenderer def={def} value={{ status: "open", qty: 1 }} onChange={() => {}} />);
    const qtyOpen = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(qtyOpen.disabled).toBe(false);
    rerender(<FormRenderer def={def} value={{ status: "closed", qty: 1 }} onChange={() => {}} />);
    const qtyClosed = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(qtyClosed.disabled).toBe(true);
  });
  it("hides field when rule sets hidden", () => {
    const d2: FormDef = {
      ...def,
      rules: [{ when: "status == 'closed'", set: [{ field: "qty", hidden: true }] }],
    };
    render(<FormRenderer def={d2} value={{ status: "closed" }} onChange={() => {}} />);
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});
