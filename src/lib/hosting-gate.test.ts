import { describe, expect, it } from "vitest";
import { PERMISSION_MATRIX, parseChildControls, type AgeCohort } from "@/lib/child-policy";
import {
  HOSTING_BLOCKED_MESSAGE,
  hostingAllowedForCohort,
  hostingFeatureDecision,
} from "@/lib/hosting-policy";

describe("game hosting age gate", () => {
  it("keeps hosting blocked for every under-16 cohort", () => {
    for (const cohort of ["child_under_13", "teen_13_15"] as const) {
      expect(PERMISSION_MATRIX.game_hosting[cohort]).toBe("blocked");
      expect(hostingAllowedForCohort(cohort)).toBe(false);
    }
  });

  it("leaves hosting available to 16-17 and adults", () => {
    expect(hostingAllowedForCohort("teen_16_17")).toBe(true);
    expect(hostingAllowedForCohort("adult")).toBe(true);
  });

  it("treats an unknown age protectively", () => {
    expect(hostingAllowedForCohort("unknown")).toBe(false);
  });

  it("blocks a 13-15 host even with guardian controls fully switched on", () => {
    const decision = hostingFeatureDecision({
      cohort: "teen_13_15" as AgeCohort,
      controls: parseChildControls({ game_participation: true, ai_analysis: true }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBeTruthy();
  });

  it("never gates a caller whose cohort is not loaded yet", () => {
    expect(hostingFeatureDecision(null).allowed).toBe(true);
  });

  it("exposes a stable blocked message for the UI", () => {
    expect(HOSTING_BLOCKED_MESSAGE).toMatch(/isn't available/i);
  });
});
