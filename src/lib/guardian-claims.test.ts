import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CASE_REF_PATTERN,
  VERIFICATION_METHODS,
  describeSignals,
  describeSuspicion,
  evidenceRefProblem,
  friendlyGuardianClaimError,
  nameMatchNote,
  normalizeCaseRef,
  reasonProblem,
  verifyActionLabel,
  verifyResultMessage,
} from "./guardian-claims";

const MIGRATION = readFileSync(
  new URL(
    "../../supabase/migrations/20261108100000_first_guardian_verification.sql",
    import.meta.url,
  ),
  "utf8",
);

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

  it("accepts only a case reference, as the database does", () => {
    expect(evidenceRefProblem("CASE-1234")).toBeNull();
    expect(evidenceRefProblem(" gv-20261104 ")).toBeNull();
    expect(evidenceRefProblem("ZD-48213-B")).toBeNull();
    expect(normalizeCaseRef(" gv-20261104 ")).toBe("GV-20261104");
    for (const bad of [
      "CASE",
      "GV-123",
      "checked their ID",
      "https://drive.example/GV-1234",
      "mom@example.com",
      `GV-${"1".repeat(70)}`,
    ]) {
      expect(evidenceRefProblem(bad)).not.toBeNull();
    }
  });

  it("uses the same case-reference pattern as the migration", () => {
    expect(MIGRATION).toContain(`v ~ '${CASE_REF_PATTERN.source}'`);
    expect(MIGRATION).toMatch(/length\(v\) BETWEEN 8 AND 64/);
  });

  it("requires a reason of 4 to 500 characters", () => {
    expect(reasonProblem("")).not.toBeNull();
    expect(reasonProblem("Not the parent")).toBeNull();
    expect(reasonProblem("x".repeat(501))).not.toBeNull();
  });

  it("labels why a claim needs two reviewers", () => {
    expect(describeSuspicion(["name_mismatch", "method_other", "new_reason"])).toEqual([
      "The invitation named a different child",
      "Verified by an 'other' method",
      "new reason",
    ]);
    expect(describeSuspicion(undefined)).toEqual([]);
  });

  it("labels the verify action by review stage", () => {
    expect(verifyActionLabel("single_review")).toBe("Verify and link");
    expect(verifyActionLabel("first_review")).toBe("Record first review");
    expect(verifyActionLabel("second_review")).toMatch(/Second review/);
    expect(verifyResultMessage("second_review_required")).toMatch(/different staff member/);
    expect(verifyResultMessage("activated")).toMatch(/now linked/);
  });

  it("shows the invitation's child name and flags a mismatch", () => {
    expect(nameMatchNote(null, null)).toBeNull();
    expect(nameMatchNote("Jordan", true)).toBe('Invitation was for "Jordan".');
    expect(nameMatchNote("Jordan", false)).toMatch(/does not match/);
  });

  it("maps database error codes to plain language", () => {
    expect(friendlyGuardianClaimError("SECOND_REVIEWER_REQUIRED: you made the first")).toMatch(
      /different staff member/,
    );
    expect(friendlyGuardianClaimError("APPEAL_REASON_REQUIRED: explain")).toMatch(/20 characters/);
    expect(
      friendlyGuardianClaimError("SIGNALS_NOT_ACKNOWLEDGED: this claimant already shares x"),
    ).toMatch(/Confirm you checked/);
    expect(friendlyGuardianClaimError("CONFLICT_OF_INTEREST: a party")).toMatch(/part of/);
    expect(friendlyGuardianClaimError("NOT_AUTHORIZED: only staff")).toMatch(/staff/);
    expect(friendlyGuardianClaimError(undefined)).toMatch(/Something went wrong/);
  });
});

describe("managed children after a staff revocation", () => {
  const fns = readFileSync(new URL("./managed-children.functions.ts", import.meta.url), "utf8");
  const handler = (name: string) => {
    const start = fns.indexOf(`export const ${name}`);
    const next = fns.indexOf("export const ", start + 1);
    return fns.slice(start, next < 0 ? undefined : next);
  };

  it("needs an active, verified guardian link, not only managed_accounts", () => {
    expect(fns).toMatch(/\.eq\("status", "active"\)\s*\.not\("verified_at", "is", null\)/);
    for (const name of ["startManagedSession", "deleteManagedChild"]) {
      const body = handler(name);
      expect(body).toMatch(/hasActiveGuardianLink\(ctx, data\.childUserId\)/);
      // checked before any service-role call
      expect(body.indexOf("hasActiveGuardianLink")).toBeLessThan(body.indexOf("supabaseAdmin"));
    }
  });
});
