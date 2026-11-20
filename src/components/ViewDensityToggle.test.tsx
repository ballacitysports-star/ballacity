// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ViewDensityToggle } from "./ViewDensityToggle";

afterEach(cleanup);

function setup(view: "list" | "map", density: "grid" | "list") {
  const onViewChange = vi.fn();
  const onDensityChange = vi.fn();
  render(
    <ViewDensityToggle
      variant="icons"
      view={view}
      density={density}
      onViewChange={onViewChange}
      onDensityChange={onDensityChange}
    />,
  );
  return { onViewChange, onDensityChange };
}

describe("ViewDensityToggle icons variant", () => {
  it("marks exactly one of grid / compact / map as active", () => {
    setup("list", "grid");
    expect(screen.getByLabelText("Grid view").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Compact view").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Map view").getAttribute("aria-pressed")).toBe("false");
  });

  it("shows compact when the list is dense, and map regardless of density", () => {
    setup("list", "list");
    expect(screen.getByLabelText("Compact view").getAttribute("aria-pressed")).toBe("true");
    cleanup();
    setup("map", "list");
    expect(screen.getByLabelText("Map view").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Compact view").getAttribute("aria-pressed")).toBe("false");
  });

  it("picking compact switches to the list view with dense cards", () => {
    const { onViewChange, onDensityChange } = setup("map", "grid");
    fireEvent.click(screen.getByLabelText("Compact view"));
    expect(onViewChange).toHaveBeenCalledWith("list");
    expect(onDensityChange).toHaveBeenCalledWith("list");
  });

  it("picking grid switches to the list view with grid cards", () => {
    const { onViewChange, onDensityChange } = setup("list", "list");
    fireEvent.click(screen.getByLabelText("Grid view"));
    expect(onViewChange).toHaveBeenCalledWith("list");
    expect(onDensityChange).toHaveBeenCalledWith("grid");
  });

  it("picking map only changes the view, leaving density alone", () => {
    const { onViewChange, onDensityChange } = setup("list", "list");
    fireEvent.click(screen.getByLabelText("Map view"));
    expect(onViewChange).toHaveBeenCalledWith("map");
    expect(onDensityChange).not.toHaveBeenCalled();
  });
});

describe("ViewDensityToggle full variant", () => {
  it("lets the density switch wrap under the view switch instead of overflowing", () => {
    // Side by side, the two switches are wider than a 320px screen's column.
    // Layout itself is checked by e2e/responsive-overflow.spec.ts.
    render(
      <ViewDensityToggle
        view="list"
        density="list"
        onViewChange={() => {}}
        onDensityChange={() => {}}
      />,
    );
    const row = screen.getByRole("tablist", { name: "View mode" }).parentElement!;
    expect(row).toBe(screen.getByRole("tablist", { name: "Card density" }).parentElement);
    expect(row.classList.contains("flex-wrap")).toBe(true);
  });
});

describe("ViewDensityToggle sheet variant", () => {
  function setupSheet(view: "list" | "map", density: "grid" | "list") {
    const onViewChange = vi.fn();
    const onDensityChange = vi.fn();
    render(
      <ViewDensityToggle
        variant="sheet"
        view={view}
        density={density}
        onViewChange={onViewChange}
        onDensityChange={onDensityChange}
      />,
    );
    return { onViewChange, onDensityChange };
  }

  it("offers grid, compact and map as worded 44px buttons in one labelled group", () => {
    setupSheet("list", "list");
    const group = screen.getByRole("group", { name: "Results layout" });
    const buttons = Array.from(group.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Grid", "Compact", "Map"]);
    for (const b of buttons) expect(b.classList.contains("min-h-11")).toBe(true);
    expect(screen.getByRole("button", { name: "Compact" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Grid" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("maps each choice onto the same view and density values", () => {
    const first = setupSheet("map", "list");
    expect(screen.getByRole("button", { name: "Map" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(first.onViewChange).toHaveBeenCalledWith("list");
    expect(first.onDensityChange).toHaveBeenCalledWith("grid");
    cleanup();

    const second = setupSheet("list", "grid");
    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    expect(second.onViewChange).toHaveBeenCalledWith("map");
    expect(second.onDensityChange).not.toHaveBeenCalled();
  });
});
