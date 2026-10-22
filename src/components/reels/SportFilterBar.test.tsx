// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SportFilterBar } from "./SportFilterBar";

afterEach(cleanup);

const sports = ["Basketball", "Soccer", "Tennis"];

describe("SportFilterBar", () => {
  it("offers All sports and one chip per sport", () => {
    render(<SportFilterBar sports={sports} selected={null} onSelect={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(sports.length + 1);
    expect(screen.getByRole("button", { name: "All sports" })).toBeTruthy();
    for (const sport of sports) expect(screen.getByRole("button", { name: sport })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Filter reels by sport" })).toBeTruthy();
  });

  it("marks only the chosen chip as pressed, whatever the case", () => {
    render(<SportFilterBar sports={sports} selected="soccer" onSelect={() => {}} />);
    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]?.textContent).toContain("Soccer");
  });

  it("marks All sports as pressed when nothing is chosen", () => {
    render(<SportFilterBar sports={sports} selected={null} onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "All sports" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("reports the sport picked, and null for All sports", () => {
    const onSelect = vi.fn();
    render(<SportFilterBar sports={sports} selected="Tennis" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Basketball" }));
    expect(onSelect).toHaveBeenLastCalledWith("Basketball");
    fireEvent.click(screen.getByRole("button", { name: "All sports" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("draws sport pictures as decoration (empty alt)", () => {
    const { container } = render(
      <SportFilterBar sports={sports} selected={null} onSelect={() => {}} />,
    );
    const imgs = container.querySelectorAll("img");
    expect(imgs).toHaveLength(sports.length);
    for (const img of imgs) expect(img.getAttribute("alt")).toBe("");
  });
});
