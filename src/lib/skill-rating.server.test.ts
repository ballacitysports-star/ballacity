import { describe, expect, it } from "vitest";
import { normalizeSkillReport } from "@/lib/skill-rating.server";

describe("normalizeSkillReport", () => {
  it("rejects output without a headline", () => {
    expect(normalizeSkillReport({})).toBeNull();
    expect(normalizeSkillReport("x")).toBeNull();
  });

  it("caps lengths and list sizes", () => {
    const r = normalizeSkillReport({
      headline: "h".repeat(500),
      whyItMoved: ["a", "b", "c", "d"],
      positions: ["PG", "SG", "SF", "PF"],
      strengths: [1, "", "ok"],
    })!;
    expect(r.headline).toHaveLength(140);
    expect(r.whyItMoved).toHaveLength(3);
    expect(r.positions).toHaveLength(3);
    expect(r.strengths).toEqual(["1", "ok"]);
    expect(r.levelNote).toBe("");
  });
});
