import { describe, expect, it } from "vitest";
import {
  levelMatchesFilter,
  levelsForSport,
  playerLevelsForSports,
  resolvePlayerLevel,
  sanitizeSkillForSport,
  formatSportLevel,
  scaleForSport,
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

describe("Football formats", () => {
  const scale = scaleForSport("Football");

  it("groups tiers into Flag, 7v7 and Full contact", () => {
    expect(scale.groups?.map((g) => g.label)).toEqual(["Flag", "7v7", "Full contact"]);
  });

  it("group tiers are exactly a partition of the flat tier list", () => {
    const flat = scale.groups!.flatMap((g) => g.tiers);
    expect(flat).toEqual(scale.tiers);
    expect(new Set(flat).size).toBe(flat.length);
  });

  it("gives every format the same sub-level ladder", () => {
    for (const g of scale.groups!) {
      expect(g.tiers).toEqual([
        `${g.label} Rec`,
        `${g.label} Competitive`,
        `${g.label} Showcase / Travel`,
        `${g.label} Elite`,
      ]);
    }
  });

  it("keeps a valid football tier in the skill filter", () => {
    expect(sanitizeSkillForSport("Football", "Full contact Elite")).toBe("Full contact Elite");
    expect(sanitizeSkillForSport("Football", "7v7 Competitive")).toBe("7v7 Competitive");
  });

  it("drops a tier that belongs to another sport", () => {
    expect(sanitizeSkillForSport("Football", "Minor AAA")).toBe("");
  });

  it("migrates retired football tiers forward", () => {
    expect(sanitizeSkillForSport("Football", "High School")).toBe("Full contact Competitive");
    expect(
      formatSportLevel(resolvePlayerLevel({ Football: { system: "Level", tier: "Semi-Pro" } }, "Football")),
    ).toBe("Full contact Elite");
  });

  it("leaves other sports' High School tier alone", () => {
    expect(sanitizeSkillForSport("Basketball", "High School")).toBe("High School");
  });

  it("does not append the scale name to 7v7 tiers", () => {
    expect(formatSportLevel({ system: "Level", tier: "7v7 Rec" })).toBe("7v7 Rec");
  });
});
