import { describe, expect, it } from "vitest";
import {
  buildFamilyRoster,
  canGuardianOpenPublicProfile,
  defaultProfileVisibilityForCohort,
} from "./family-roster";
import type { AgeCohort } from "./child-policy";
import type { GuardianChild } from "./child-safety.functions";

function child(over: Partial<GuardianChild> = {}): GuardianChild {
  return {
    childUserId: "c1",
    displayName: "Sam Rivera",
    username: "sam",
    avatarUrl: null,
    cohort: "teen_13_15",
    ageReviewRequired: false,
    relationship: "parent",
    linkedAt: "2026-01-01T00:00:00Z",
    upcomingGames: 0,
    nextGame: null,
    teamCount: 0,
    consent: null,
    controls: {} as GuardianChild["controls"],
    ...over,
  };
}

function approved(over: Partial<GuardianChild> = {}) {
  return child({
    consent: { status: "approved" } as GuardianChild["consent"],
    ...over,
  });
}

describe("buildFamilyRoster — grouping", () => {
  it("puts a child awaiting approval in the group that needs the guardian", () => {
    const r = buildFamilyRoster([
      child({ consent: { status: "pending" } as GuardianChild["consent"] }),
    ]);
    expect(r.needsAction).toHaveLength(1);
    expect(r.approved).toHaveLength(0);
    expect(r.needsAction[0]!.status).toBe("awaiting_approval");
  });

  it("treats withdrawn consent as needing the guardian, not as approved", () => {
    // The account is paused; leaving it under "approved players" would tell a
    // guardian the opposite of what is true.
    const r = buildFamilyRoster([
      child({ consent: { status: "revoked" } as GuardianChild["consent"] }),
    ]);
    expect(r.needsAction[0]!.status).toBe("consent_withdrawn");
    expect(r.approved).toHaveLength(0);
  });

  it("treats a missing consent record as needing the guardian", () => {
    const r = buildFamilyRoster([child({ consent: null })]);
    expect(r.needsAction[0]!.status).toBe("no_consent");
  });

  it("puts an approved child under approved players", () => {
    const r = buildFamilyRoster([approved()]);
    expect(r.approved).toHaveLength(1);
    expect(r.needsAction).toHaveLength(0);
    expect(r.approved[0]!.needsGuardian).toBe(false);
  });

  it("splits a mixed family into both groups and keeps every child in all", () => {
    const r = buildFamilyRoster([
      approved({ childUserId: "a", displayName: "Ana" }),
      child({ childUserId: "b", displayName: "Ben", consent: null }),
    ]);
    expect(r.needsAction.map((e) => e.child.childUserId)).toEqual(["b"]);
    expect(r.approved.map((e) => e.child.childUserId)).toEqual(["a"]);
    expect(r.all).toHaveLength(2);
  });

  it("orders each group by name so the roster does not reshuffle between renders", () => {
    const r = buildFamilyRoster([
      approved({ childUserId: "z", displayName: "Zoe" }),
      approved({ childUserId: "a", displayName: "Ana" }),
      approved({ childUserId: "m", displayName: "Max" }),
    ]);
    expect(r.approved.map((e) => e.child.displayName)).toEqual(["Ana", "Max", "Zoe"]);
  });

  it("returns empty groups for a guardian with no linked children", () => {
    const r = buildFamilyRoster([]);
    expect(r.needsAction).toEqual([]);
    expect(r.approved).toEqual([]);
    expect(r.all).toEqual([]);
  });

  it("surfaces an age review alongside the status rather than replacing it", () => {
    const r = buildFamilyRoster([approved({ ageReviewRequired: true })]);
    expect(r.approved[0]!.status).toBe("approved");
    expect(r.approved[0]!.ageReviewRequired).toBe(true);
  });
});

describe("profile visibility", () => {
  /**
   * These mirror public.default_profile_visibility_for(). If that function
   * changes, this is the test that should fail — the UI decides whether to
   * render a link to /players/$userId from it, and a wrong answer sends a
   * guardian to a page the profiles RLS policy will not let them read.
   */
  it.each([
    ["adult", "public"],
    ["teen_16_17", "members"],
    ["teen_13_15", "members"],
    ["child_under_13", "private"],
    ["unknown", "private"],
  ] as [AgeCohort, string][])("maps %s to %s", (cohort, expected) => {
    expect(defaultProfileVisibilityForCohort(cohort)).toBe(expected);
  });

  it("does not offer a public profile link for an under-13 account", () => {
    // 'private' is enforced against everyone but the account itself — the
    // guardian included — so the link would dead-end.
    expect(canGuardianOpenPublicProfile(child({ cohort: "child_under_13" }))).toBe(false);
    expect(
      buildFamilyRoster([child({ cohort: "child_under_13" })]).all[0]!.publicProfileReachable,
    ).toBe(false);
  });

  it("does not offer one when the age is unknown", () => {
    expect(canGuardianOpenPublicProfile(child({ cohort: "unknown" }))).toBe(false);
  });

  it("offers it for teen accounts, which are visible to signed-in members", () => {
    expect(canGuardianOpenPublicProfile(child({ cohort: "teen_13_15" }))).toBe(true);
    expect(canGuardianOpenPublicProfile(child({ cohort: "teen_16_17" }))).toBe(true);
  });
});
