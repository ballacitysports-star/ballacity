import { describe, expect, it } from "vitest";
import { POSITIONS_BY_SPORT, SPORTS } from "./sample-data";
import { SPORT_GUIDES, SPORT_GUIDE_SLUGS, guideBySlug, slugForSport } from "./sports-guide";

describe("sports guide content", () => {
  it("covers every sport exactly once, in chip order", () => {
    expect(SPORT_GUIDES.map((g) => g.sport)).toEqual(SPORTS.map((s) => s.name));
  });

  it("gives every sport real copy", () => {
    for (const g of SPORT_GUIDES) {
      expect(g.tagline.length).toBeGreaterThan(10);
      expect(g.groupSize.length).toBeGreaterThan(3);
      expect(g.sessionLength.length).toBeGreaterThan(3);
      expect(g.skillNotes.length).toBeGreaterThan(20);
      expect(g.howItWorks.length).toBeGreaterThanOrEqual(3);
      expect(g.bring.length).toBeGreaterThanOrEqual(3);
      expect(g.etiquette.length).toBeGreaterThanOrEqual(3);
      expect(g.cover).toBeTruthy();
    }
  });

  it("round-trips slugs, including unknown ones", () => {
    expect(new Set(SPORT_GUIDE_SLUGS).size).toBe(SPORTS.length);
    for (const { name } of SPORTS) {
      const slug = slugForSport(name);
      expect(guideBySlug(slug)?.sport).toBe(name);
      expect(guideBySlug(slug.toUpperCase())?.sport).toBe(name);
    }
    expect(guideBySlug("cricket")).toBeUndefined();
  });

  it("reuses the app's canonical positions", () => {
    for (const g of SPORT_GUIDES) {
      expect(g.positions).toEqual(POSITIONS_BY_SPORT[g.sport]);
    }
  });
});
