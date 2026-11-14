// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FilterBar } from "./FilterBar";

afterEach(cleanup);

describe("FilterBar", () => {
  it("lets the search pill shrink, so the buttons beside it stay on a 320px screen", () => {
    // A flex item does not shrink below its content's min-content width unless
    // it says so, and an <input>'s is a font-dependent ~20 characters. Layout
    // itself is checked by e2e/responsive-overflow.spec.ts; this pins the rule.
    render(<FilterBar q="" onQChange={() => {}} searchPlaceholder="Search players" sheet={null} />);
    const pill = screen.getByPlaceholderText("Search players").parentElement!;
    expect(pill.classList.contains("flex-1")).toBe(true);
    expect(pill.classList.contains("min-w-0")).toBe(true);
  });
});
