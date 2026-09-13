import { describe, expect, it } from "vitest";
import {
  filterTiersForSport,
  levelMatchesFilter,
  levelTiers,
  toggleSportTier,
  levelsForSport,
  playerLevelsForSports,
  resolvePlayerLevel,
  sanitizeSkillForSport,
  formatSportLevel,
  scaleForSport,
  parseSportLevels,
  serializeSportLevels,
} from "./sport-levels";

const raw = {
  Baseball: { system: "Level", tier: "College / Adult Competitive" },
  Tennis: { system: "NTRP", tier: "3.5" },
};

describe("resolvePlayerLevel", () => {
  it("prefers the profile tier over the post's generic level", () => {
    expect(formatSportLevel(resolvePlayerLevel(raw, "Baseball", "Advanced"))).toBe(
      "College / Adult Competitive",
    );
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
    expect(levelMatchesFilter(raw, ["Baseball"], "Advanced", "College / Adult Competitive")).toBe(
      true,
    );
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
    expect(levelsForSport("Baseball" as any)).toContain("College / Adult Competitive");
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
        `${g.label} Casual`,
        `${g.label} Rec`,
        `${g.label} Competitive`,
        `${g.label} Travel / Showcase`,
      ]);
    }
  });

  it("keeps a valid football tier in the skill filter", () => {
    expect(sanitizeSkillForSport("Football", "Full contact Travel / Showcase")).toBe(
      "Full contact Travel / Showcase",
    );
    expect(sanitizeSkillForSport("Football", "7v7 Competitive")).toBe("7v7 Competitive");
  });

  it("drops a tier that belongs to another sport", () => {
    expect(sanitizeSkillForSport("Football", "College / Adult Competitive")).toBe("");
  });

  it("migrates retired football tiers forward", () => {
    expect(sanitizeSkillForSport("Football", "High School")).toBe("Full contact Competitive");
    expect(
      formatSportLevel(
        resolvePlayerLevel({ Football: { system: "Level", tier: "Semi-Pro" } }, "Football"),
      ),
    ).toBe("Full contact Travel / Showcase");
  });

  it("leaves other sports' High School tier alone", () => {
    expect(sanitizeSkillForSport("Basketball", "High School")).toBe("High School");
  });

  it("does not append the scale name to 7v7 tiers", () => {
    expect(formatSportLevel({ system: "Level", tier: "7v7 Rec" })).toBe("7v7 Rec");
  });
});

describe("feed + matchmaking with football sub-levels", () => {
  const football = { Football: { system: "Level", tier: "7v7 Competitive" } };

  it("offers every football sub-level to the skill filter", () => {
    expect(filterTiersForSport("Football")).toContain("Flag Rec");
    expect(filterTiersForSport("Football")).toContain("7v7 Travel / Showcase");
    expect(filterTiersForSport("Football")).toContain("Full contact Travel / Showcase");
  });

  it("matches a post on the author's profile tier", () => {
    expect(levelMatchesFilter(football, ["Football"], "All Levels", "7v7 Competitive")).toBe(true);
    expect(levelMatchesFilter(football, ["Football"], "All Levels", "7v7 Travel / Showcase")).toBe(
      false,
    );
  });

  it("lets the profile tier win over a generic tier stored on the post", () => {
    expect(levelMatchesFilter(football, ["Football"], "Intermediate", "Intermediate")).toBe(false);
    expect(formatSportLevel(resolvePlayerLevel(football, "Football", "Intermediate"))).toBe(
      "7v7 Competitive",
    );
  });

  it("falls back to the post's tier only when the profile has none", () => {
    expect(
      levelMatchesFilter(
        {},
        ["Football"],
        "Full contact Travel / Showcase",
        "Full contact Travel / Showcase",
      ),
    ).toBe(true);
  });

  it("matches a legacy football post against the migrated tier", () => {
    const legacy = { Football: { system: "Level", tier: "High School" } };
    expect(levelMatchesFilter(legacy, ["Football"], null, "Full contact Competitive")).toBe(true);
  });

  it("keeps a football tier out of another sport's filter", () => {
    expect(sanitizeSkillForSport("Basketball", "7v7 Travel / Showcase")).toBe("");
    expect(sanitizeSkillForSport("", "7v7 Travel / Showcase")).toBe("");
  });
});

describe("multiple football levels", () => {
  it("accumulates tiers across formats, keeping the highest as primary", () => {
    let lvl = toggleSportTier("Football", null, "7v7 Travel / Showcase");
    lvl = toggleSportTier("Football", lvl, "Flag Rec");
    expect(new Set(levelTiers(lvl))).toEqual(new Set(["Flag Rec", "7v7 Travel / Showcase"]));
    expect(lvl?.tier).toBe("7v7 Travel / Showcase");
    expect(formatSportLevel(lvl)).toBe("7v7 Travel / Showcase · Flag Rec");
  });

  it("removes a tier on second tap and clears the level when empty", () => {
    let lvl = toggleSportTier("Football", null, "Flag Rec");
    lvl = toggleSportTier("Football", lvl, "Full contact Travel / Showcase");
    lvl = toggleSportTier("Football", lvl, "Flag Rec");
    expect(levelTiers(lvl)).toEqual(["Full contact Travel / Showcase"]);
    expect(toggleSportTier("Football", lvl, "Full contact Travel / Showcase")).toBeNull();
  });

  it("allows multiple tiers on every sport", () => {
    const one = toggleSportTier("Tennis", { system: "NTRP", tier: "3.5" }, "4.0");
    expect(levelTiers(one).sort()).toEqual(["3.5", "4.0"]);
    expect(levelTiers(toggleSportTier("Tennis", one, "4.0"))).toEqual(["3.5"]);
  });

  it("round-trips multiple tiers through storage", () => {
    const stored = serializeSportLevels([
      {
        name: "Football",
        level: { system: "Level", tier: "Flag Rec", tiers: ["Flag Rec", "7v7 Travel / Showcase"] },
      },
    ]);
    expect(stored.Football.tiers).toEqual(["Flag Rec", "7v7 Travel / Showcase"]);
    expect(parseSportLevels(stored).Football.tier).toBe("7v7 Travel / Showcase");
  });

  it("matches a filter against any selected tier", () => {
    const raw = {
      Football: {
        system: "Level",
        tier: "7v7 Travel / Showcase",
        tiers: ["Flag Rec", "7v7 Travel / Showcase"],
      },
    };
    expect(levelMatchesFilter(raw, ["Football"], null, "Flag Rec")).toBe(true);
    expect(levelMatchesFilter(raw, ["Football"], null, "7v7 Travel / Showcase")).toBe(true);
    expect(levelMatchesFilter(raw, ["Football"], null, "Flag Pro")).toBe(false);
  });

  it("migrates legacy tiers inside a multi selection", () => {
    const raw = { Football: { system: "Level", tier: "Flag Rec", tiers: ["Flag Rec", "College"] } };
    expect(levelTiers(parseSportLevels(raw).Football)).toContain("Full contact Travel / Showcase");
  });
});
