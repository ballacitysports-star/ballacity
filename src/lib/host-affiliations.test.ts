import { describe, expect, it } from "vitest";
import {
  affiliationLabel,
  hostAffiliations,
  preferredAffiliation,
  teamIdFor,
  type HostAffiliation,
} from "./host-affiliations";

const teams = [
  { id: "t1", name: "Sunday Run", kind: "team" as const },
  { id: "c1", name: "Coach Dee", kind: "coach" as const },
];

describe("hostAffiliations", () => {
  it("offers an adult themselves first, then their teams (no coach profiles)", () => {
    expect(hostAffiliations({ teams, cohort: "adult", selfName: " Ana " })).toEqual([
      { source: "self", id: "self", name: "Ana" },
      { source: "team", id: "t1", name: "Sunday Run", kind: "team" },
    ]);
  });

  it("an adult with no team can still host, as themselves", () => {
    expect(hostAffiliations({ teams: [], cohort: "adult" })).toEqual([
      { source: "self", id: "self", name: "You" },
    ]);
  });

  it("a 16-17-year-old (or anyone not known to be an adult) gets only their teams", () => {
    for (const cohort of ["teen_16_17", "teen_13_15", null, undefined, "unknown"]) {
      const choices = hostAffiliations({ teams, cohort, selfName: "Teen" });
      expect(choices.map((c) => c.source)).toEqual(["team"]);
    }
    expect(hostAffiliations({ teams: [], cohort: "teen_16_17" })).toEqual([]);
  });
});

describe("preferredAffiliation", () => {
  const self: HostAffiliation = { source: "self", id: "self", name: "Ana" };
  const t1: HostAffiliation = { source: "team", id: "t1", name: "Sunday Run" };
  const t2: HostAffiliation = { source: "team", id: "t2", name: "Tuesday Run" };

  it("the team the app is acting as wins", () => {
    expect(preferredAffiliation([self, t1, t2], { teamId: "t2", actingAsTeam: true })).toBe(t2);
  });

  it("acting as the person picks themselves", () => {
    expect(preferredAffiliation([self, t1], { teamId: null, actingAsTeam: false })).toBe(self);
  });

  it("otherwise the only choice, or nothing (the member picks)", () => {
    expect(preferredAffiliation([t1], { teamId: "gone", actingAsTeam: true })).toBe(t1);
    expect(preferredAffiliation([t1, t2], { teamId: "gone", actingAsTeam: true })).toBeNull();
    expect(preferredAffiliation([], { actingAsTeam: false })).toBeNull();
  });
});

describe("teamIdFor and labels", () => {
  it("hosting as oneself saves no team", () => {
    expect(teamIdFor({ source: "self", id: "self", name: "Ana" })).toBeUndefined();
    expect(teamIdFor({ source: "team", id: "t1", name: "x" })).toBe("t1");
    expect(teamIdFor(null)).toBeUndefined();
    expect(affiliationLabel({ source: "self", id: "self", name: "Ana" })).toBe("You");
    expect(affiliationLabel({ source: "team", id: "t1", name: "x" })).toBe("Team");
  });
});
