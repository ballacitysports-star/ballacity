import { describe, expect, it } from "vitest";
import {
  REVIEW_AUTHOR_MESSAGE,
  REVIEW_SUBJECT_MESSAGE,
  assertReviewAllowedByAge,
  isConfirmedAdult,
  isPersonReview,
  mayAnalyseSubject,
} from "@/lib/review-age.server";

const ADULT = "11111111-1111-4111-8111-111111111111";
const TEEN = "22222222-2222-4222-8222-222222222222";

/** A stand-in for the service-role client: answers age_cohort_of from a table of cohorts. */
function admin(cohorts: Record<string, string>, opts: { fail?: boolean; throws?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push(`${fn}:${String(args["_user"])}`);
      if (opts.throws) throw new Error("network");
      if (opts.fail) return { data: null, error: { message: "boom" } };
      return { data: cohorts[String(args["_user"])] ?? "unknown", error: null };
    },
  };
}

describe("isConfirmedAdult", () => {
  it("is true only for the adult cohort", async () => {
    const a = admin({
      [ADULT]: "adult",
      [TEEN]: "teen_16_17",
      c13: "child_under_13",
      t14: "teen_13_15",
    });
    expect(await isConfirmedAdult(a, ADULT)).toBe(true);
    for (const id of [TEEN, "c13", "t14", "nobody"])
      expect(await isConfirmedAdult(a, id)).toBe(false);
  });

  it("fails closed: no id, a failed lookup, a thrown error", async () => {
    expect(await isConfirmedAdult(admin({}), null)).toBe(false);
    expect(await isConfirmedAdult(admin({}), undefined)).toBe(false);
    expect(await isConfirmedAdult(admin({ [ADULT]: "adult" }, { fail: true }), ADULT)).toBe(false);
    expect(await isConfirmedAdult(admin({ [ADULT]: "adult" }, { throws: true }), ADULT)).toBe(
      false,
    );
  });
});

describe("assertReviewAllowedByAge", () => {
  const a = () => admin({ [ADULT]: "adult", other: "adult", [TEEN]: "teen_16_17" });

  it("lets an adult review an adult", async () => {
    await expect(
      assertReviewAllowedByAge(a(), {
        authorId: ADULT,
        revieweeKind: "player",
        revieweeId: "other",
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a minor author, whatever is being reviewed", async () => {
    for (const kind of ["player", "host", "team", "trainer"]) {
      await expect(
        assertReviewAllowedByAge(a(), { authorId: TEEN, revieweeKind: kind, revieweeId: "other" }),
      ).rejects.toThrow(REVIEW_AUTHOR_MESSAGE);
    }
  });

  it("refuses a person under 18 or of unknown age as the subject of a player or host review", async () => {
    for (const kind of ["player", "host"]) {
      for (const subject of [TEEN, "ghost"]) {
        await expect(
          assertReviewAllowedByAge(a(), {
            authorId: ADULT,
            revieweeKind: kind,
            revieweeId: subject,
          }),
        ).rejects.toThrow(REVIEW_SUBJECT_MESSAGE);
      }
    }
  });

  it("does not look up the subject of a team or trainer review (they are not people)", async () => {
    const client = a();
    await assertReviewAllowedByAge(client, {
      authorId: ADULT,
      revieweeKind: "team",
      revieweeId: "tm-1",
    });
    expect(client.calls).toEqual([`age_cohort_of:${ADULT}`]);
  });
});

describe("mayAnalyseSubject", () => {
  it("never allows AI to read reviews about, or summarise, a person who is not a confirmed adult", async () => {
    const a = admin({ [ADULT]: "adult", [TEEN]: "teen_16_17" });
    expect(await mayAnalyseSubject(a, { revieweeKind: "player", revieweeUserId: ADULT })).toBe(
      true,
    );
    expect(await mayAnalyseSubject(a, { revieweeKind: "player", revieweeUserId: TEEN })).toBe(
      false,
    );
    expect(await mayAnalyseSubject(a, { revieweeKind: "host", revieweeUserId: TEEN })).toBe(false);
    expect(await mayAnalyseSubject(a, { revieweeKind: "player", revieweeUserId: null })).toBe(
      false,
    );
  });

  it("is unchanged for teams and trainers", async () => {
    const a = admin({});
    expect(await mayAnalyseSubject(a, { revieweeKind: "team", revieweeUserId: TEEN })).toBe(true);
    expect(await mayAnalyseSubject(a, { revieweeKind: "trainer", revieweeUserId: null })).toBe(
      true,
    );
  });
});

describe("isPersonReview", () => {
  it("is true for players and hosts only", () => {
    expect(["player", "host", "team", "trainer", "gym"].map(isPersonReview)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});
