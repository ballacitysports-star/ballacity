import { describe, expect, it } from "vitest";
import {
  DIRECTORY_FILTERS,
  applyDirectoryFilters,
  matchesDirectoryFilter,
  parseDirectoryFilters,
  serializeDirectoryFilters,
  type DirectoryFilterId,
  type FilterableOrg,
} from "@/lib/org-directory-filters";

const NOW = new Date("2026-10-06T15:00:00Z"); // Tuesday 3 PM UTC
const day = { ranges: [{ open: "06:00", close: "22:00" }] };
const week = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), day]));

const org = (over: Partial<FilterableOrg> = {}): FilterableOrg => ({
  category: "Gym",
  amenities: [],
  hours: week,
  timezone: "UTC",
  ...over,
});
const sel = (...ids: DirectoryFilterId[]) => new Set(ids);

describe("directory pills", () => {
  it("offers All plus the four primary filters", () => {
    expect(DIRECTORY_FILTERS.map((f) => f.label)).toEqual([
      "Open now",
      "Court rentals",
      "Indoor courts",
      "Outdoor courts",
    ]);
  });

  it("Open now follows the facility's own timezone", () => {
    expect(matchesDirectoryFilter(org(), "open", NOW)).toBe(true);
    expect(matchesDirectoryFilter(org({ hours: {} }), "open", NOW)).toBe(false);
    // 15:00 UTC is 04:00 in Honolulu, before the 06:00 opening.
    expect(matchesDirectoryFilter(org({ timezone: "Pacific/Honolulu" }), "open", NOW)).toBe(false);
    expect(
      matchesDirectoryFilter(
        org({ hours: { "2": { ranges: [{ open: "06:00", close: "14:00" }] } } }),
        "open",
        NOW,
      ),
    ).toBe(false);
  });

  it("Court rentals matches the category or the amenity", () => {
    expect(matchesDirectoryFilter(org({ category: "Court rental" }), "rentals")).toBe(true);
    expect(matchesDirectoryFilter(org({ amenities: ["Court rentals"] }), "rentals")).toBe(true);
    expect(matchesDirectoryFilter(org({ category: null }), "rentals")).toBe(false);
  });

  it("Indoor / Outdoor match category or amenity, and cages don't count as outdoor courts", () => {
    expect(matchesDirectoryFilter(org({ category: "Indoor courts" }), "indoor")).toBe(true);
    expect(matchesDirectoryFilter(org({ amenities: ["Indoor courts"] }), "indoor")).toBe(true);
    expect(matchesDirectoryFilter(org({ amenities: ["Outdoor courts"] }), "outdoor")).toBe(true);
    expect(matchesDirectoryFilter(org({ amenities: ["Outdoor cages"] }), "outdoor")).toBe(false);
    expect(matchesDirectoryFilter(org({ amenities: null }), "indoor")).toBe(false);
  });
});

describe("applyDirectoryFilters", () => {
  const a = { ...org({ amenities: ["Indoor courts", "Court rentals"] }), id: "a" };
  const b = { ...org({ amenities: ["Outdoor courts"] }), id: "b" };
  const c = { ...org({ amenities: ["Indoor courts"], hours: {} }), id: "c" };
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

  it("returns everyone when no pill is selected (All)", () => {
    expect(ids(applyDirectoryFilters([a, b, c], sel(), NOW))).toEqual(["a", "b", "c"]);
  });

  it("narrows with each selected pill (they combine)", () => {
    expect(ids(applyDirectoryFilters([a, b, c], sel("indoor"), NOW))).toEqual(["a", "c"]);
    expect(ids(applyDirectoryFilters([a, b, c], sel("indoor", "open"), NOW))).toEqual(["a"]);
    expect(ids(applyDirectoryFilters([a, b, c], sel("rentals", "outdoor"), NOW))).toEqual([]);
  });

  it("does not mutate the input", () => {
    const list = [a, b, c];
    applyDirectoryFilters(list, sel("indoor"), NOW);
    expect(list).toHaveLength(3);
  });
});

describe("directory filters in the URL", () => {
  it("round-trips in a fixed order, whatever order they were picked in", () => {
    const picked = new Set<DirectoryFilterId>(["indoor", "open"]);
    const text = serializeDirectoryFilters(picked);
    expect(text).toBe("open,indoor");
    expect([...parseDirectoryFilters(text)].sort()).toEqual(["indoor", "open"]);
  });

  it("is empty for no pills", () => {
    expect(serializeDirectoryFilters(new Set())).toBe("");
    expect(parseDirectoryFilters("").size).toBe(0);
    expect(parseDirectoryFilters(undefined).size).toBe(0);
  });

  it("ignores unknown ids and stray spaces from a hand-edited link", () => {
    expect([...parseDirectoryFilters("open, bogus ,,indoor")].sort()).toEqual(["indoor", "open"]);
  });
});
