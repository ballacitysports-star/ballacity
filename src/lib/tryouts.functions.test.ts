import { describe, expect, it } from "vitest";
import { toTryoutListing, type TryoutRow } from "./tryouts.functions";

const row = (over: Partial<TryoutRow> = {}): TryoutRow => ({
  id: "p1",
  kind: "tryout",
  title: "U14 fall tryouts",
  body: "Bring water",
  event_date: "2026-10-17T14:00:00.000Z",
  location: "Bogan Park",
  price: 15,
  spots_max: 30,
  spots_taken: 3,
  team_id: "t1",
  teams: {
    name: "BallaCity Select",
    avatar: "https://img.test/crest.png",
    sports: ["Basketball"],
    verified: true,
    age_groups: ["youth"],
  },
  ...over,
});

describe("toTryoutListing", () => {
  it("maps the row and the hosting team", () => {
    expect(toTryoutListing(row(), new Set(["t1"]))).toEqual({
      id: "p1",
      kind: "tryout",
      title: "U14 fall tryouts",
      body: "Bring water",
      eventDate: "2026-10-17T14:00:00.000Z",
      location: "Bogan Park",
      price: 15,
      spotsMax: 30,
      spotsTaken: 3,
      teamId: "t1",
      teamName: "BallaCity Select",
      teamAvatar: "https://img.test/crest.png",
      teamVerified: true,
      teamAgeGroups: ["youth"],
      sports: ["Basketball"],
      waiverRequired: true,
    });
  });

  it("flags a waiver only for teams that have one published", () => {
    expect(toTryoutListing(row(), new Set(["other-team"])).waiverRequired).toBe(false);
    expect(toTryoutListing(row(), new Set(["t1"])).waiverRequired).toBe(true);
  });

  it("reports the waiver as unknown, not absent, when it could not be looked up", () => {
    expect(toTryoutListing(row(), null).waiverRequired).toBeNull();
  });

  it("falls back safely when the team or counters are missing", () => {
    const out = toTryoutListing(row({ teams: null, body: null, spots_taken: null }), new Set());
    expect(out).toMatchObject({
      teamName: "Team",
      teamAvatar: null,
      teamVerified: false,
      teamAgeGroups: [],
      sports: [],
      body: "",
      spotsTaken: 0,
    });
  });
});
