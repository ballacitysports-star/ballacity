import { describe, expect, it } from "vitest";
import {
  describeSkill,
  estimateSkill,
  gameReferenceLevel,
  scoreToTier,
  tierToScore,
  voterWeight,
  type SkillSignal,
} from "@/lib/skill-rating";

const NOW = Date.parse("2026-10-12T00:00:00Z");
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const peer = (vote: -1 | 0 | 1, gameLevel = 50, days = 5): SkillSignal => ({
  kind: "peer",
  vote,
  gameLevel,
  weight: 1,
  date: ago(days),
});

describe("skill estimate", () => {
  it("starts at the prior with no evidence", () => {
    const e = estimateSkill([], NOW);
    expect(e.mu).toBe(50);
    expect(e.status).toBe("provisional");
  });

  it("treats a self rating as a loose starting point", () => {
    const e = estimateSkill([{ kind: "self", value: 70 }], NOW);
    expect(e.mu).toBeGreaterThan(60);
    expect(e.mu).toBeLessThan(70);
    expect(e.status).toBe("provisional");
  });

  it("moves toward peer evidence and tightens as votes accumulate", () => {
    const self: SkillSignal = { kind: "self", value: 40 };
    const few = estimateSkill([self, peer(1, 60)], NOW);
    const many = estimateSkill([self, ...Array.from({ length: 12 }, () => peer(1, 60))], NOW);
    expect(few.mu).toBeGreaterThan(40);
    expect(many.mu).toBeGreaterThan(few.mu);
    expect(many.sigma).toBeLessThan(few.sigma);
    expect(many.status).not.toBe("provisional");
    expect(many.contributions.peer).toBeGreaterThan(many.contributions.self);
  });

  it("discounts old votes", () => {
    const fresh = estimateSkill([{ kind: "self", value: 40 }, peer(1, 60, 1)], NOW);
    const stale = estimateSkill([{ kind: "self", value: 40 }, peer(1, 60, 700)], NOW);
    expect(fresh.mu).toBeGreaterThan(stale.mu);
  });

  it("aggregates clips with diminishing returns", () => {
    const clip = (v: number): SkillSignal => ({ kind: "video", value: v, date: ago(10) });
    const one = estimateSkill([clip(80)], NOW);
    const five = estimateSkill([clip(80), clip(80), clip(80), clip(80), clip(80)], NOW);
    expect(five.sigma).toBeLessThan(one.sigma);
    // a 5x increase in clips must not give 5x the certainty
    expect(1 / five.sigma ** 2 - 1 / 30 ** 2).toBeLessThan(2 * (1 / one.sigma ** 2 - 1 / 30 ** 2));
  });

  it("keeps the interval inside 0–100", () => {
    const e = estimateSkill([{ kind: "self", value: 100 }, peer(1, 100)], NOW);
    expect(e.high).toBeLessThanOrEqual(100);
    expect(e.low).toBeGreaterThanOrEqual(0);
  });
});

describe("scale mapping", () => {
  it("round-trips tiers on a numeric scale", () => {
    const s = tierToScore("Tennis", "3.5")!;
    expect(scoreToTier("Tennis", s)).toBe("3.5");
    expect(tierToScore("Tennis", "5.0")!).toBeGreaterThan(tierToScore("Tennis", "2.0")!);
  });

  it("maps a submenu division onto its parent rung", () => {
    expect(tierToScore("Baseball", "Minors (Ages 7–11)")).toBe(
      tierToScore("Baseball", "Rec League"),
    );
  });

  it("returns null for unknown tiers and labels a range", () => {
    expect(tierToScore("Tennis", "9.9")).toBeNull();
    const l = describeSkill("Tennis", { low: 40, high: 60 });
    expect(l.label.startsWith("≈ ")).toBe(true);
    expect(l.label).toContain("NTRP");
  });

  it("averages game levels with a fallback", () => {
    expect(gameReferenceLevel([40, 60, null])).toBe(50);
    expect(gameReferenceLevel([])).toBe(50);
  });

  it("trusts settled voters more", () => {
    expect(voterWeight(6)).toBeGreaterThan(voterWeight(25));
    expect(voterWeight(null)).toBe(0.8);
  });
});
