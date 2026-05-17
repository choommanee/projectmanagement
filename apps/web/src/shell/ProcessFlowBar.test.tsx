import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProcessFlowBar } from "./ProcessFlowBar";

describe("ProcessFlowBar", () => {
  it("marks current stage with primary background", () => {
    render(<ProcessFlowBar stages={[{id:"a",label:"A"},{id:"b",label:"B"},{id:"c",label:"C"}]} current="b" />);
    const b = screen.getByText("B");
    expect(b.className).toContain("bg-primary");
  });
});
