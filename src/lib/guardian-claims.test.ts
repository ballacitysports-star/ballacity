import { describe, expect, it } from "vitest";
import {
  VERIFICATION_METHODS,
  describeSignals,
  evidenceRefProblem,
  friendlyGuardianClaimError,
  reasonProblem,
} from "./guardian-claims";

describe("guardian claims", () => {
  it("offers exactly the methods the database accepts", () => {
    expect(VERIFICATION_METHODS.map((m) => m.value)).toEqual([
      "government_id",
      "consent_document",
      "video_call",
      "school_or_league_record",
      "court_order",
      "other",
    ]);
  });

  it("labels known signals and keeps unknown ones readable", () => {
    expect(describeSignals(["shared_team", "new_signal"])).toEqual([
      "Shares a team with the child (coach, owner, teammate or team invite)",
      "new signal",
    ]);
    expect(describeSignals(null)).toEqual([]);
  });

  it("requires an evidence reference of 4 to 200 characters", () => {
    expect(evidenceRefProblem("  ab ")).not.toBeNull();
    expect(evidenceRefProblem("CASE-1234")).toBeNull();
    expect(evidenceRefProblem("x".repeat(201))).not.toBeNull();
  });

  it("requires a reason of 4 to 500 characters", () => {
    expect(reasonProblem("")).not.toBeNull();
    expect(reasonProblem("Not the parent")).toBeNull();
    expect(reasonProblem("x".repeat(501))).not.toBeNull();
  });

  it("maps database error codes to plain language", () => {
    expect(
      friendlyGuardianClaimError("SIGNALS_NOT_ACKNOWLEDGED: this claimant already shares x"),
    ).toMatch(/Confirm you checked/);
    expect(friendlyGuardianClaimError("CONFLICT_OF_INTEREST: a party")).toMatch(/part of/);
    expect(friendlyGuardianClaimError("NOT_AUTHORIZED: only staff")).toMatch(/staff/);
    expect(friendlyGuardianClaimError(undefined)).toMatch(/Something went wrong/);
  });
});
