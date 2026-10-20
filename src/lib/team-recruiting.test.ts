import { describe, it, expect } from "vitest";
import { featuredRecruitingTeam, openSpotCount } from "./team-recruiting";

type T = Parameters<typeof featuredRecruitingTeam>[0][number];

const team = (over: Partial<T> & { id?: string } = {}): T & { id: string } => ({
  id: "t",
  kind: "team",
  verified: false,
  positionsNeeded: {},
  ...over,
});

describe("openSpotCount", () => {
  it("adds up every position across every sport", () => {
    expect(openSpotCount({ Basketball: { Guard: 2, Center: 1 }, Soccer: { Goalkeeper: 1 } })).toBe(
      4,
    );
  });

  it("is zero when nothing is posted", () => {
    expect(openSpotCount(undefined)).toBe(0);
    expect(openSpotCount({})).toBe(0);
    expect(openSpotCount({ Basketball: {} })).toBe(0);
  });

  it("ignores zero, negative and non-numeric counts", () => {
    expect(
      openSpotCount({
        Basketball: { Guard: 0, Forward: -2, Center: Number.NaN, Wing: "3" as unknown as number },
      }),
    ).toBe(3);
  });
});

describe("featuredRecruitingTeam", () => {
  it("features nothing when no team is recruiting", () => {
    expect(featuredRecruitingTeam([team({ id: "a" }), team({ id: "b", verified: true })])).toBe(
      undefined,
    );
    expect(featuredRecruitingTeam([])).toBe(undefined);
  });

  it("prefers a verified team that is recruiting", () => {
    const open = { Basketball: { Guard: 1 } };
    const picked = featuredRecruitingTeam([
      team({ id: "plain", positionsNeeded: open }),
      team({ id: "verified", verified: true, positionsNeeded: open }),
    ]);
    expect(picked?.id).toBe("verified");
  });

  it("falls back to an unverified recruiting team", () => {
    const picked = featuredRecruitingTeam([
      team({ id: "verified-but-full", verified: true }),
      team({ id: "plain", positionsNeeded: { Soccer: { Striker: 2 } } }),
    ]);
    expect(picked?.id).toBe("plain");
  });

  it("never features a coach profile", () => {
    expect(
      featuredRecruitingTeam([
        team({ id: "coach", kind: "coach", positionsNeeded: { Basketball: { Guard: 1 } } }),
      ]),
    ).toBe(undefined);
  });
});
