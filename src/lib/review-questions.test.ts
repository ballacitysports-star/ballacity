import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_TAGS,
  PRAISE_TAGS,
  REVIEW_QUESTIONS,
  REVIEW_TARGET_KINDS,
  ReviewInputError,
  normalizeReviewExtras,
  safetyConcern,
  tagLabel,
} from "@/lib/review-questions";

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20261021120000_review_questions.sql", import.meta.url),
  "utf8",
);

/** Parses `WHEN 'kind' THEN ARRAY['a','b']` lines out of one SQL function. */
function sqlKeys(fn: string): Record<string, string[]> {
  const start = MIGRATION.indexOf(`FUNCTION public.${fn}(`);
  expect(start, `${fn} missing from the migration`).toBeGreaterThan(-1);
  const body = MIGRATION.slice(start, MIGRATION.indexOf("$$;", start));
  const out: Record<string, string[]> = {};
  for (const m of body.matchAll(/WHEN '(\w+)' THEN ARRAY\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/'(\w+)'/g)].map((k) => k[1]);
  }
  return out;
}

describe("question/tag lists match the database", () => {
  const sqlQuestions = sqlKeys("review_question_keys");
  const sqlTags = sqlKeys("review_tag_keys");

  it.each(REVIEW_TARGET_KINDS)("%s: question keys are identical in TypeScript and SQL", (kind) => {
    expect(sqlQuestions[kind]).toEqual(REVIEW_QUESTIONS[kind].map((q) => q.key));
  });

  it.each(REVIEW_TARGET_KINDS)("%s: tag keys are identical in TypeScript and SQL", (kind) => {
    expect(sqlTags[kind]).toEqual(PRAISE_TAGS[kind].map((t) => t.key));
  });

  it("the SQL tag cap and answer values match", () => {
    expect(MIGRATION).toContain(`cardinality(NEW.tags) > ${MAX_TAGS}`);
    expect(MIGRATION).toContain("NOT IN ('yes', 'mostly', 'no')");
    expect(MIGRATION).toContain("recommend IN ('yes', 'not_sure', 'no')");
  });

  it("every key is a plain identifier (safe to embed in SQL arrays and JSON keys)", () => {
    for (const kind of REVIEW_TARGET_KINDS) {
      for (const q of REVIEW_QUESTIONS[kind]) expect(q.key).toMatch(/^[A-Za-z]+$/);
      for (const t of PRAISE_TAGS[kind]) expect(t.key).toMatch(/^[A-Za-z]+$/);
    }
  });

  it("player tags that feed sportsmanship badges use the trait's own key", () => {
    const keys = PRAISE_TAGS.player.map((t) => t.key);
    for (const trait of ["respectful", "communicative", "fairPlay", "positive", "onTime"]) {
      expect(keys).toContain(trait);
      expect(MIGRATION).toContain(`'${trait}' = ANY (r.tags)`);
    }
  });
});

describe("normalizeReviewExtras", () => {
  it("accepts a complete, valid set and de-duplicates tags", () => {
    expect(
      normalizeReviewExtras("player", {
        recommend: "yes",
        answers: { fair: "yes", respect: "mostly" },
        tags: ["fairPlay", "onTime", "fairPlay"],
      }),
    ).toEqual({
      recommend: "yes",
      answers: { fair: "yes", respect: "mostly" },
      tags: ["fairPlay", "onTime"],
    });
  });

  it("requires the headline answer but not the rest", () => {
    expect(normalizeReviewExtras("team", { recommend: "not_sure" })).toEqual({
      recommend: "not_sure",
      answers: {},
      tags: [],
    });
    expect(() => normalizeReviewExtras("team", {})).toThrow(ReviewInputError);
    expect(() => normalizeReviewExtras("team", { recommend: "maybe" })).toThrow(
      /would do this again/,
    );
  });

  it("rejects keys and values that belong to another kind or don't exist", () => {
    expect(() =>
      normalizeReviewExtras("player", { recommend: "yes", answers: { safe: "yes" } }),
    ).toThrow(/Invalid answers/);
    expect(() =>
      normalizeReviewExtras("player", { recommend: "yes", answers: { fair: "sure" } }),
    ).toThrow(/Invalid answers/);
    expect(() => normalizeReviewExtras("player", { recommend: "yes", answers: ["fair"] })).toThrow(
      /Invalid answers/,
    );
    expect(() => normalizeReviewExtras("player", { recommend: "yes", tags: ["wellRun"] })).toThrow(
      /Invalid tags/,
    );
    expect(() => normalizeReviewExtras("player", { recommend: "yes", tags: "fairPlay" })).toThrow(
      /Invalid tags/,
    );
    expect(() => normalizeReviewExtras("player", { recommend: "yes", tags: [1] })).toThrow(
      /Invalid tags/,
    );
  });

  it(`caps tags at ${MAX_TAGS}`, () => {
    const six = PRAISE_TAGS.player.slice(0, MAX_TAGS + 1).map((t) => t.key);
    expect(() => normalizeReviewExtras("player", { recommend: "yes", tags: six })).toThrow(
      /up to 5 tags/,
    );
    expect(
      normalizeReviewExtras("player", { recommend: "yes", tags: six.slice(0, MAX_TAGS) }).tags,
    ).toHaveLength(MAX_TAGS);
  });
});

describe("safety escalation", () => {
  it("fires only for a 'No' on a safety question", () => {
    expect(safetyConcern("host", { safe: "no" })?.key).toBe("safe");
    expect(safetyConcern("trainer", { safe: "no" })?.key).toBe("safe");
    expect(safetyConcern("host", { safe: "mostly" })).toBeNull();
    expect(safetyConcern("host", { fairRules: "no", accurate: "no" })).toBeNull();
    expect(safetyConcern("player", { fair: "no", respect: "no" })).toBeNull();
    expect(safetyConcern("team", {})).toBeNull();
  });

  it("flags exactly the host and trainer safety questions", () => {
    const flagged = REVIEW_TARGET_KINDS.flatMap((k) =>
      REVIEW_QUESTIONS[k].filter((q) => q.safety).map((q) => `${k}.${q.key}`),
    );
    expect([...flagged].sort()).toEqual(["host.safe", "trainer.safe"]);
  });
});

describe("tagLabel", () => {
  it("returns the label, falling back to the key", () => {
    expect(tagLabel("player", "fairPlay")).toBe("Plays fair");
    expect(tagLabel("player", "unknown")).toBe("unknown");
  });
});
