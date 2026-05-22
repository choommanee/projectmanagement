import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./Tabs";

function Harness() {
  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="details">Details</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">Overview panel</TabsContent>
      <TabsContent value="details">Details panel</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("renders the default panel and marks aria-selected", () => {
    render(<Harness />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    const details = screen.getByRole("tab", { name: "Details" });
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(details).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("Overview panel")).toBeInTheDocument();
    expect(screen.queryByText("Details panel")).not.toBeInTheDocument();
  });

  it("switches content when a trigger is clicked", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("tab", { name: "Details" }));
    expect(screen.getByRole("tab", { name: "Details" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Details panel")).toBeInTheDocument();
    expect(screen.queryByText("Overview panel")).not.toBeInTheDocument();
  });
});
