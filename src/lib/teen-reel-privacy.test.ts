import { describe, expect, it } from "vitest";
import {
  BAND_COPY,
  TEEN_RESTRICTION,
  TEEN_REEL_OPTIONS,
  bandCopyFor,
  privacyBandFor,
  teenReelErrorMessage,
  teenReelState,
} from "@/lib/teen-reel-privacy";

describe("privacyBandFor", () => {
  it("maps each cohort and refuses to guess an unknown age", () => {
    expect(privacyBandFor("child_under_13")).toBe("under_13");
    expect(privacyBandFor("teen_13_15")).toBe("teen_13_15");
    expect(privacyBandFor("teen_16_17")).toBe("teen_16_17");
    expect(privacyBandFor("adult")).toBe("adult");
    for (const c of ["unknown", null, undefined, ""]) expect(bandCopyFor(c)).toBeNull();
  });
});

describe("band copy", () => {
  it("states the agreed line for each age group", () => {
    expect(BAND_COPY.under_13.summary).toBe("Private to your family and approved team spaces. Never public.");
    expect(BAND_COPY.teen_13_15.summary).toBe(
      "Private by default. A verified guardian may share with approved teams and coaches. Not shown publicly.",
    );
    expect(BAND_COPY.teen_16_17.summary).toBe(
      "Visible to signed-in BallaCity members when shared. Public discovery is off.",
    );
    expect(BAND_COPY.adult.summary).toBe("You choose: private, team-only, members, or public Highlights.");
  });

  it("never offers public, member-wide or share links to under 16", () => {
    for (const band of ["under_13", "teen_13_15"] as const) {
      const all = [...BAND_COPY[band].audiences].join(" ").toLowerCase();
      expect(all).not.toContain("public highlights");
      expect(all).not.toContain("signed-in members");
    }
    expect(BAND_COPY.teen_13_15.never.join(" ")).toContain("Share links");
    expect(TEEN_RESTRICTION).toBe("This reel will not appear on public profiles, search, or Highlights.");
  });
});

describe("teen reel options", () => {
  it("has exactly guardian-only and verified team", () => {
    expect(TEEN_REEL_OPTIONS.map((o) => o.value)).toEqual(["guardian", "team"]);
  });

  it("is guardian-only unless a team AND an approving guardian are both set", () => {
    expect(teenReelState({})).toBe("guardian");
    expect(teenReelState({ team_share_team_id: "T1" })).toBe("guardian");
    expect(teenReelState({ guardian_team_approved_by: "g" })).toBe("guardian");
    expect(teenReelState({ team_share_team_id: "T1", guardian_team_approved_by: "g" })).toBe("team");
  });
});

describe("teenReelErrorMessage", () => {
  it("maps database codes and ignores the rest", () => {
    expect(teenReelErrorMessage(new Error("TEEN_TEAM_GUARDIAN_ONLY"))).toContain("guardian");
    expect(teenReelErrorMessage(new Error("boom"))).toBeNull();
  });
});
