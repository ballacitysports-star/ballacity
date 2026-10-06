import { describe, expect, it } from "vitest";
import {
  analyticsAudience,
  analyticsGrounding,
  analyticsText,
  normalizeAdvancedAnalytics,
  parseCueTime,
} from "@/lib/reel-analytics";

const NOW = new Date("2026-10-06T12:00:00Z");

const RAW = {
  sport: "basketball",
  ratings: { overall: 78.4, mechanics: 140, explosiveness: -5, iq: "66", execution: 74 },
  biomechanics: [
    { t: "0:03", area: "Release", cue: "Elbow flares on the shot", kind: "fix" },
    { t: 1.25, area: "Base", cue: "Balanced, shoulder-width base", kind: "strength" },
    { t: 99, area: "Hips", cue: "Past the end of the clip", kind: "fix" },
    { t: "soon", area: "Arms", cue: "No usable time", kind: "fix" },
  ],
  archetype: "Slashing Playmaker",
  comps: [
    { name: "Pro A", match: 72, why: "Hesitation into a left-hand finish" },
    { name: "Pro B", similarity: 61, why: "Euro step footwork" },
    { name: "Pro C", match: 50, why: "third comp is dropped" },
  ],
  scout: {
    tier: "high school varsity",
    strengths: ["Burst", "Handle", "Finishing", "Extra"],
    drills: ["Form shooting", "Mikan drill", "Extra"],
    quote: "Plays downhill with purpose. Needs a consistent release.",
  },
  confidence: "Side angle, decent light.",
};

describe("normalizeAdvancedAnalytics", () => {
  it("clamps ratings, orders and bounds cues, and caps lists", () => {
    const a = normalizeAdvancedAnalytics(RAW, {
      cohort: "adult",
      duration: 8,
      model: "google/gemini-2.5-pro",
      now: NOW,
    })!;
    expect(a.ratings).toEqual({
      overall: 78,
      mechanics: 100,
      explosiveness: 0,
      iq: 66,
      execution: 74,
    });
    expect(a.biomechanics.map((c) => c.t)).toEqual([1.25, 3, 8]);
    expect(a.biomechanics[0].kind).toBe("strength");
    expect(a.comps).toEqual([
      { name: "Pro A", match: 72, why: "Hesitation into a left-hand finish" },
      { name: "Pro B", match: 61, why: "Euro step footwork" },
    ]);
    expect(a.scout?.tier).toBe("High School Varsity");
    expect(a.scout?.strengths).toHaveLength(3);
    expect(a.scout?.drills).toHaveLength(2);
    expect(a.model).toBe("google/gemini-2.5-pro");
    expect(a.generated_at).toBe(NOW.toISOString());
  });

  it("withholds scout report and pro comps for under-13 and unknown ages", () => {
    for (const cohort of ["child_under_13", "unknown", null] as const) {
      const a = normalizeAdvancedAnalytics(RAW, { cohort, now: NOW })!;
      expect(a.scout).toBeNull();
      expect(a.comps).toEqual([]);
      expect(a.biomechanics.length).toBeGreaterThan(0);
    }
    expect(analyticsAudience("teen_13_15")).toBe("full");
  });

  it("returns null without any ratings and fills missing ones", () => {
    expect(normalizeAdvancedAnalytics({ biomechanics: RAW.biomechanics })).toBeNull();
    expect(normalizeAdvancedAnalytics("not json")).toBeNull();
    const a = normalizeAdvancedAnalytics({ ratings: { mechanics: 60, iq: 80 } })!;
    expect(a.ratings.overall).toBe(70);
    expect(a.ratings.execution).toBe(70);
  });

  it("drops a scout report with an unknown tier", () => {
    const a = normalizeAdvancedAnalytics(
      { ...RAW, scout: { ...RAW.scout, tier: "Future Hall of Famer" } },
      { cohort: "adult" },
    )!;
    expect(a.scout).toBeNull();
  });
});

describe("helpers", () => {
  it("parses cue times", () => {
    expect(parseCueTime("1:05.5")).toBe(65.5);
    expect(parseCueTime("2.5s")).toBe(2.5);
    expect(parseCueTime(-1)).toBeNull();
    expect(parseCueTime(undefined)).toBeNull();
  });

  it("exposes every AI string for moderation and grounds the coach", () => {
    const a = normalizeAdvancedAnalytics(RAW, { cohort: "adult", duration: 8 })!;
    const text = analyticsText(a);
    expect(text).toContain("Elbow flares");
    expect(text).toContain("Plays downhill");
    expect(text).toContain("Pro A");
    expect(analyticsText(null)).toBe("");
    const grounding = analyticsGrounding(a);
    expect(grounding).toContain("Mechanics & technique 100");
    expect(grounding).toContain("0:03 [fix] Release");
  });
});
