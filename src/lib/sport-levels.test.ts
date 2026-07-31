import { describe, expect, it } from "vitest";
import {
  levelMatchesFilter,
  levelsForSport,
  playerLevelsForSports,
  resolvePlayerLevel,
  formatSportLevel,
} from "./sport-levels";

const raw = {
  Baseball: { system: "MiLB", tier: "Minor AAA" },
  Tennis: { system: "NTRP", tier: "3.5" },
};

describe("resolvePlayerLevel", () => {
  it("prefers the profile tier over the post's generic level", () => {
    expect(formatSportLevel(resolvePlayerLevel(raw, "Baseball", "Advanced"))).toBe("Minor AAA");
  });
  it("falls back to the post level when the profile has none", () => {
    expect(formatSportLevel(resolvePlayerLevel(raw, "Soccer", "Beginner"))).toBe("Beginner");
  });
  it("ignores the legacy All Levels value", () => {
    expect(resolvePlayerLevel(null, "Soccer", "All Levels")).toBeNull();
  });
  it("appends the scale name for numeric tiers", () => {
    expect(formatSportLevel(resolvePlayerLevel(raw, "Tennis", null))).toBe("3.5 NTRP");
  });
});

describe("playerLevelsForSports", () => {
  it("returns only sports that have a profile tier", () => {
    expect(playerLevelsForSports(raw, ["Baseball", "Soccer"])).toEqual([
      { sport: "Baseball", level: raw.Baseball },
    ]);
  });
});

describe("levelMatchesFilter", () => {
  it("matches a profile tier even when the post says otherwise", () => {
    expect(levelMatchesFilter(raw, ["Baseball"], "Advanced", "Minor AAA")).toBe(true);
  });
  it("does not match the post level when the profile has a tier", () => {
    expect(levelMatchesFilter(raw, ["Baseball"], "Advanced", "Advanced")).toBe(false);
  });
  it("matches the post level when the profile is silent", () => {
    expect(levelMatchesFilter(raw, ["Soccer"], "Advanced", "Advanced")).toBe(true);
  });
  it("passes everything when no filter is set", () => {
    expect(levelMatchesFilter(null, ["Soccer"], null, "")).toBe(true);
  });
});

describe("levelsForSport", () => {
  it("gives sport-specific tiers", () => {
    expect(levelsForSport("Baseball" as any)).toContain("Minor AAA");
    expect(levelsForSport("Tennis" as any)).toContain("3.5");
  });
});

describe("sanitizeSkillForSport", () => {
  it("keeps a tier that belongs to the sport's scale", () => {
    expect(sanitizeSkillForSport("Baseball", levelsForSport("Baseball" as never)[1])).toBe(
      levelsForSport("Baseball" as never)[1],
    );
  });
  it("drops a tier from a different sport's scale", () => {
    const tennisTier = levelsForSport("Tennis" as never)[0];
    expect(sanitizeSkillForSport("Baseball", tennisTier)).toBe("");
  });
  it("allows legacy generic tiers when no sport is picked", () => {
    expect(sanitizeSkillForSport("", "Intermediate")).toBe("Intermediate");
    expect(sanitizeSkillForSport("", levelsForSport("Baseball" as never)[0])).toBe("");
  });
  it("passes empty values through", () => {
    expect(sanitizeSkillForSport("Baseball", "")).toBe("");
    expect(sanitizeSkillForSport(null, undefined)).toBe("");
  });
});
