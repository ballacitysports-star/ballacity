// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("@/components/FilterSheet", () => ({ FilterSheet: () => null }));

import { FilterBar } from "./FilterBar";

afterEach(cleanup);

const base = { q: "", onQChange: () => {}, sheet: null };

describe("FilterBar active filter chips", () => {
  it("lists each active filter as a chip that removes just that filter", () => {
    const removeDistance = vi.fn();
    const removePrice = vi.fn();
    render(
      <FilterBar
        {...base}
        activeFilterCount={2}
        onReset={() => {}}
        activeChips={[
          { id: "distance", label: "Within 10 mi", onRemove: removeDistance },
          { id: "price", label: "Free only", onRemove: removePrice },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Free only" }));
    expect(removePrice).toHaveBeenCalledTimes(1);
    expect(removeDistance).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Clear all" })).toBeTruthy();
    expect(screen.queryByText(/filters? on/)).toBeNull();
  });

  it("keeps the plain count line when there are no chips (e.g. only a sport is on)", () => {
    render(<FilterBar {...base} activeFilterCount={1} onReset={() => {}} activeChips={[]} />);
    expect(screen.getByText("1 filter on")).toBeTruthy();
  });

  it("is unchanged for pages that do not pass chips", () => {
    render(<FilterBar {...base} activeFilterCount={3} onReset={() => {}} />);
    expect(screen.getByText("3 filters on")).toBeTruthy();
  });
});
