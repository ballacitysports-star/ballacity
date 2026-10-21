import { describe, expect, it } from "vitest";
import {
  buildSkillFields,
  initialLevelsForPost,
  parseIntents,
  parsePostSkillLevels,
  postTiersForSport,
} from "./availability-levels";
import { availabilityPatchFromProfile } from "./availability-sync";

describe("availability levels", () => {
  it("stores every sport's tiers and keeps the primary sport in skill_level", () => {
    const fields = buildSkillFields(["Basketball", "Tennis"], {
      Basketball: ["AAU / Travel", "High School"],
      Tennis: [],
    });
    expect(fields.skill_levels).toEqual({ Basketball: "High School · AAU / Travel" });
    expect(fields.skill_level).toBe("High School · AAU / Travel");
    expect(buildSkillFields([], {}).skill_level).toBe("All Levels");
  });

  it("caps skill_level at the database's 120 characters", () => {
    const tiers = ["Casual / Pickup", "Rec League", "High School", "Club / Travel", "College / Adult Competitive"];
    const long = buildSkillFields(["Soccer"], { Soccer: [...tiers, ...tiers] });
    expect(long.skill_level.length).toBeLessThanOrEqual(120);
  });

  it("reads explicit levels and falls back to skill_level for the primary sport only", () => {
    const legacy = { sports: ["Tennis", "Pickleball"], skill_level: "3.5", skill_levels: {} };
    expect(postTiersForSport(legacy, "Tennis")).toEqual(["3.5"]);
    expect(postTiersForSport(legacy, "Pickleball")).toEqual([]);
    const post = { ...legacy, skill_levels: { Pickleball: "3.0 · 4.0", Ghost: "x" } };
    expect(parsePostSkillLevels(post.skill_levels, post.sports)).toEqual({ Pickleball: ["3.0", "4.0"] });
    expect(initialLevelsForPost(post)).toEqual({ Tennis: ["3.5"], Pickleball: ["3.0", "4.0"] });
  });

  it("keeps only known intents", () => {
    expect(parseIntents(["tryout", "nope", "guest"])).toEqual(["guest", "tryout"]);
    expect(parseIntents(null)).toEqual([]);
  });
});

describe("profile sync keeps picked levels", () => {
  const base = {
    sports: ["Basketball"],
    skill_level: "High School · AAU / Travel",
    skill_levels: { Basketball: "High School · AAU / Travel" },
    city: "Austin",
    formatted_address: null,
    place_id: null,
    lat: null,
    lng: null,
    travel_radius_km: 40,
  };

  it("does not overwrite levels chosen on the post with the profile tier", () => {
    const patch = availabilityPatchFromProfile(base, {
      sports: [{ name: "Basketball", level: { system: "Level", tier: "Rec League" } }],
    });
    expect(patch?.skill_level).toBeUndefined();
  });

  it("drops picked levels for sports removed from the post", () => {
    const patch = availabilityPatchFromProfile(
      { ...base, sports: ["Basketball", "Soccer"], skill_levels: { ...base.skill_levels, Soccer: "Rec League" } },
      { sports: [{ name: "Basketball" }] },
    );
    expect(patch?.sports).toEqual(["Basketball"]);
    expect(patch?.skill_levels).toEqual({ Basketball: "High School · AAU / Travel" });
  });
});
