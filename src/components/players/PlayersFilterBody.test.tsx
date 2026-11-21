// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Density, ViewMode } from "@/components/ViewDensityToggle";

/**
 * WP 4.1: Find Players has no layout toggle of its own any more. The filter sheet's "View" section is the only way
 * into Grid, Compact or Map, and the map has its own "Show list". The sheet's sport chips start with Basketball, then
 * the member's own sports.
 */
vi.mock("@/lib/user-prefs-store", () => ({ useDistanceUnit: () => "mi" }));
vi.mock("@/components/DistanceSlider", () => ({ DistanceSlider: () => null }));
vi.mock("@/components/filters/SportSkillLevels", () => ({ SportSkillLevels: () => null }));

import { PlayersFilterBody } from "./PlayersFilterBody";
import { PlayersMapHeader } from "./PlayersMapHeader";
import { basketballFirstPriority } from "@/lib/sport-hubs";
import { SPORTS } from "@/lib/sample-data";

function show({
  viewMode = "list" as ViewMode,
  density = "grid" as Density,
  sportPriority = basketballFirstPriority([]),
} = {}) {
  const onViewChange = vi.fn();
  const onDensityChange = vi.fn();
  const onToggleSport = vi.fn();
  render(
    <PlayersFilterBody
      viewMode={viewMode}
      onViewChange={onViewChange}
      density={density}
      onDensityChange={onDensityChange}
      sportPriority={sportPriority}
      sports={[]}
      onToggleSport={onToggleSport}
      onClearSports={vi.fn()}
      skills={{}}
      setSkills={vi.fn()}
      maxDistance={0}
      setMaxDistance={vi.fn()}
      ageMin=""
      setAgeMin={vi.fn()}
      ageMax=""
      setAgeMax={vi.fn()}
      includeUnknownAge
      setIncludeUnknownAge={vi.fn()}
      sortBy="recent"
      setSortBy={vi.fn()}
    />,
  );
  return { onViewChange, onDensityChange, onToggleSport };
}

const layout = () => within(screen.getByRole("group", { name: "Results layout" }));

/** The sport chip names in the "Sports (Players)" section, in order. */
function sportChips(): string[] {
  const section = screen.getByRole("heading", { name: "Sports (Players)" }).closest("section")!;
  return (
    within(section as HTMLElement)
      .getAllByRole("button")
      // A sport chip is its emoji, then its name.
      .map((b) => (b.lastChild?.textContent ?? "").trim())
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Find Players filter sheet", () => {
  it("has the View section first, with the current layout pressed", () => {
    show({ viewMode: "map" });
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toBe("View");
    expect(layout().getByRole("button", { name: "Map" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("Map switches the page to the map", () => {
    const { onViewChange, onDensityChange } = show();
    fireEvent.click(layout().getByRole("button", { name: "Map" }));
    expect(onViewChange).toHaveBeenCalledWith("map");
    expect(onDensityChange).not.toHaveBeenCalled();
  });

  it("Compact is the list view in the compact density", () => {
    const { onViewChange, onDensityChange } = show({ viewMode: "map" });
    fireEvent.click(layout().getByRole("button", { name: "Compact" }));
    expect(onViewChange).toHaveBeenCalledWith("list");
    expect(onDensityChange).toHaveBeenCalledWith("list");
  });

  it("Grid is the list view in the grid density", () => {
    const { onViewChange, onDensityChange } = show({ viewMode: "map", density: "list" });
    fireEvent.click(layout().getByRole("button", { name: "Grid" }));
    expect(onViewChange).toHaveBeenCalledWith("list");
    expect(onDensityChange).toHaveBeenCalledWith("grid");
  });

  it("sport chips: All sports, then Basketball, then the member's sports, then every other sport", () => {
    const { onToggleSport } = show({
      sportPriority: basketballFirstPriority(["Pickleball", "Soccer"]),
    });
    const chips = sportChips();
    expect(chips.slice(0, 4)).toEqual(["All sports", "Basketball", "Pickleball", "Soccer"]);
    // Nothing is hidden: every sport has a chip.
    expect(chips).toHaveLength(SPORTS.length + 1);
    expect(new Set(chips.slice(1))).toEqual(new Set(SPORTS.map((s) => s.name)));
    fireEvent.click(screen.getByRole("button", { name: /Pickleball/ }));
    expect(onToggleSport).toHaveBeenCalledWith("Pickleball");
  });

  it("a member with no sports still gets Basketball first", () => {
    show();
    expect(sportChips().slice(0, 2)).toEqual(["All sports", "Basketball"]);
  });
});

describe("Find Players map header", () => {
  it("Show list takes the member back to the list", () => {
    const onShowList = vi.fn();
    render(<PlayersMapHeader onShowList={onShowList} />);
    fireEvent.click(screen.getByRole("button", { name: "Show list" }));
    expect(onShowList).toHaveBeenCalledTimes(1);
  });
});

describe("Find Players page wiring (supplement to the render tests above)", () => {
  it("the sheet and the map header drive the page's own view and density", () => {
    const src = readFileSync("src/routes/_tabs.players.tsx", "utf8");
    expect(src).toContain("onViewChange={switchView}");
    expect(src).toContain("onDensityChange={switchDensity}");
    expect(src).toContain('<PlayersMapHeader onShowList={() => switchView("list")} />');
    expect(src).toMatch(/sportPriority = useMemo\(\s*\(\) => basketballFirstPriority\(/);
  });
});
