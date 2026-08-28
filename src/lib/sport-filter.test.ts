import { describe, expect, it } from "vitest";
import {
  countSkillSelections,
  matchesSportList,
  matchesSportSkillFilter,
  parseSportList,
  parseSportSkillMap,
  sanitizeSportSkillMap,
  serializeSportList,
  serializeSportSkillMap,
  toggleSport,
  toggleSportSkillTier,
} from "@/lib/sport-filter";

describe("sport list params", () => {
  it("round-trips a comma list and de-dupes", () => {
    expect(parseSportList("Baseball, Football,Baseball")).toEqual(["Baseball", "Football"]);
    expect(serializeSportList(["Baseball", "Football"])).toBe("Baseball,Football");
    expect(parseSportList("")).toEqual([]);
  });

  it("toggles sports in and out, and clears on null", () => {
    expect(toggleSport([], "Tennis")).toEqual(["Tennis"]);
    expect(toggleSport(["Tennis"], "Tennis")).toEqual([]);
    expect(toggleSport(["Tennis"], null)).toEqual([]);
  });
});

describe("per-sport skill map", () => {
  it("round-trips per-sport tiers", () => {
    const sports = ["Baseball", "Tennis"];
    const raw = "Baseball:College / Adult Competitive|Tennis:3.5";
    const map = parseSportSkillMap(raw, sports);
    expect(map).toEqual({ Baseball: "College / Adult Competitive", Tennis: "3.5" });
    expect(serializeSportSkillMap(map, sports)).toBe(raw);
  });

  it("drops tiers a sport's scale does not have and unselected sports", () => {
    expect(parseSportSkillMap("Baseball:3.5|Tennis:3.5", ["Baseball", "Tennis"])).toEqual({
      Tennis: "3.5",
    });
    expect(parseSportSkillMap("Tennis:3.5", ["Baseball"])).toEqual({});
    expect(sanitizeSportSkillMap({ Tennis: "3.5" }, ["Baseball"])).toEqual({});
  });

  it("reads a legacy flat value onto the first selected sport", () => {
    expect(parseSportSkillMap("Rec", ["Baseball", "Tennis"])).toEqual({ Baseball: "Rec League" });
  });

  it("keeps every sport multi-select", () => {
    let map = toggleSportSkillTier({}, "Football", "Flag Rec");
    map = toggleSportSkillTier(map, "Football", "7v7 Travel / Showcase");
    expect(map.Football).toBe("Flag Rec · 7v7 Travel / Showcase");
    map = toggleSportSkillTier(map, "Football", "Flag Rec");
    expect(map.Football).toBe("7v7 Travel / Showcase");

    let t = toggleSportSkillTier({}, "Tennis", "3.5");
    t = toggleSportSkillTier(t, "Tennis", "4.0");
    expect(t.Tennis).toBe("3.5 · 4.0");
    expect(toggleSportSkillTier(t, "Tennis", "4.0").Tennis).toBe("3.5");
  });
});

describe("matching", () => {
  const levels = {
    Baseball: { system: "Level", tier: "College / Adult Competitive" },
    Tennis: { system: "NTRP", tier: "3.0" },
  };

  it("requires at least one selected sport on the post", () => {
    expect(matchesSportSkillFilter(levels, ["Tennis"], null, ["Baseball"], {})).toBe(false);
    expect(matchesSportSkillFilter(levels, ["Tennis"], null, ["Tennis"], {})).toBe(true);
  });

  it("ORs across selected sports and only constrains sports with a tier", () => {
    const skills = { Baseball: "College / Adult Competitive", Tennis: "4.5" };
    // Baseball matches even though the Tennis tier does not.
    expect(
      matchesSportSkillFilter(levels, ["Baseball", "Tennis"], null, ["Baseball", "Tennis"], skills),
    ).toBe(true);
    expect(matchesSportSkillFilter(levels, ["Tennis"], null, ["Tennis"], skills)).toBe(false);
    // Sports without a picked tier are unconstrained.
    expect(
      matchesSportSkillFilter(levels, ["Tennis"], null, ["Tennis"], { Baseball: "College / Adult Competitive" }),
    ).toBe(true);
  });

  it("matches orgs on any selected sport", () => {
    expect(matchesSportList(["Soccer"], [])).toBe(true);
    expect(matchesSportList(["Soccer"], ["Baseball", "Soccer"])).toBe(true);
    expect(matchesSportList(["Soccer"], ["Baseball"])).toBe(false);
  });
});
