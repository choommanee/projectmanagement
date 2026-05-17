import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppSwitcher } from "./AppSwitcher";

describe("AppSwitcher", () => {
  it("lists apps and selects one", () => {
    const onSelect = vi.fn();
    render(<AppSwitcher current="pm" apps={[{id:"pm",name:"PM"},{id:"mfg",name:"Mfg"}]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /PM/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Mfg" }));
    expect(onSelect).toHaveBeenCalledWith("mfg");
  });
});
