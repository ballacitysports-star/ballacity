import { describe, it, expect } from "vitest";
import { filterTrainersByVenue } from "./trainer-feed-filter";
import type { Org } from "./sample-data";

function trainer(id: string, venues: string[] = []): Org {
  return {
    id,
    kind: "coach",
    name: `T-${id}`,
    handle: `@t${id}`,
    tagline: "",
    city: "",
    founded: 2020,
    sports: [],
    verified: false,
    cover: "",
    avatar: "",
    accent: "#000",
    followers: 0,
    roster: 0,
    bio: "",
    achievements: [],
    venueAddresses: venues,
  } as unknown as Org;
}

function team(id: string, venues: string[] = []): Org {
  return { ...trainer(id, venues), kind: "team" } as Org;
}

const VENUE_A = "123 Main St, Brooklyn, NY";
const VENUE_B = "500 Ocean Ave, Miami, FL";

describe("filterTrainersByVenue", () => {
  const orgs: Org[] = [
    trainer("a", [VENUE_A]),
    trainer("b", [VENUE_B]),
    trainer("c", [VENUE_A, VENUE_B]),
    trainer("d", []),
    team("t1", [VENUE_A]),
  ];

  it("returns all coach orgs when venue is empty", () => {
    const out = filterTrainersByVenue(orgs, "");
    expect(out.map((o) => o.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("returns all coach orgs when venue is whitespace only", () => {
    const out = filterTrainersByVenue(orgs, "   ");
    expect(out.map((o) => o.id).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("narrows to trainers offering an exact venue", () => {
    const out = filterTrainersByVenue(orgs, VENUE_A);
    expect(out.map((o) => o.id).sort()).toEqual(["a", "c"]);
  });

  it("is case- and whitespace-insensitive", () => {
    const out = filterTrainersByVenue(orgs, `  ${VENUE_B.toUpperCase()}  `);
    expect(out.map((o) => o.id).sort()).toEqual(["b", "c"]);
  });

  it("excludes non-coach orgs even when their venue matches", () => {
    const out = filterTrainersByVenue(orgs, VENUE_A);
    expect(out.some((o) => o.id === "t1")).toBe(false);
  });

  it("matches trainers with multiple venues on any of them", () => {
    const out = filterTrainersByVenue(orgs, VENUE_B);
    expect(out.map((o) => o.id).sort()).toEqual(["b", "c"]);
  });

  it("returns empty for an unknown venue", () => {
    const out = filterTrainersByVenue(orgs, "999 Nowhere");
    expect(out).toEqual([]);
  });
});
