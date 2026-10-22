import { describe, expect, it } from "vitest";
import { toPublicTeam, toPublicTrainer, type PublicTeamRow } from "./city-seo";

const row = (over: Partial<PublicTeamRow> = {}): PublicTeamRow => ({
  id: "t1",
  name: "Harlem Hoopers",
  city: "New York, NY",
  sports: ["Basketball"],
  kind: "team",
  tagline: "Run-and-gun since 2019",
  age_groups: ["adult"],
  hidden_at: null,
  handle: "@hoopers",
  bio: "Open runs every Sunday.",
  verified: true,
  founded: 2019,
  positions_needed: { Basketball: { Guard: 2, Center: 1 } },
  ...over,
});

describe("toPublicTeam", () => {
  it("returns the public facts of an ordinary team", () => {
    expect(toPublicTeam(row())).toEqual({
      id: "t1",
      name: "Harlem Hoopers",
      handle: "@hoopers",
      city: "New York, NY",
      sports: ["Basketball"],
      tagline: "Run-and-gun since 2019",
      bio: "Open runs every Sunday.",
      verified: true,
      founded: 2019,
      openSpots: 3,
    });
  });

  it("never carries roster, staff or contact fields", () => {
    const keys = Object.keys(
      toPublicTeam(row({ staff: [{ name: "Coach K" }], email: "a@b.c", phone: "555" } as never)) ??
        {},
    );
    expect(keys.sort()).toEqual(
      [
        "bio",
        "city",
        "founded",
        "handle",
        "id",
        "name",
        "openSpots",
        "sports",
        "tagline",
        "verified",
      ].sort(),
    );
  });

  it("hides a hidden team", () => {
    expect(toPublicTeam(row({ hidden_at: "2026-10-01T00:00:00Z" }))).toBeNull();
  });

  it("hides a team that works with kids or teens", () => {
    expect(toPublicTeam(row({ age_groups: ["youth"] }))).toBeNull();
    expect(toPublicTeam(row({ age_groups: ["adult", "teen"] }))).toBeNull();
  });

  it("hides a coach profile, whose page is not public", () => {
    expect(toPublicTeam(row({ kind: "coach" }))).toBeNull();
  });

  it("treats missing data as empty, not as verified or recruiting", () => {
    const t = toPublicTeam(
      row({ verified: null, sports: null, positions_needed: null, bio: null, handle: null }),
    );
    expect(t).toMatchObject({ verified: false, sports: [], openSpots: 0, bio: null, handle: null });
  });

  it("trims a very long bio", () => {
    expect(toPublicTeam(row({ bio: "x".repeat(2000) }))?.bio?.length).toBe(400);
  });
});

describe("toPublicTrainer", () => {
  const coach = (over: Partial<PublicTeamRow> = {}) => row({ kind: "coach", ...over });

  it("returns the public facts of a trainer, with no team-only or private fields", () => {
    const t = toPublicTrainer(
      coach({ rate_per_hour: 80, session_types: ["1:1"], availability_slots: [] } as never),
    );
    expect(Object.keys(t ?? {}).sort()).toEqual(
      ["bio", "city", "handle", "id", "name", "sports", "tagline", "verified"].sort(),
    );
  });

  it("is not a team, and a team is not a trainer", () => {
    expect(toPublicTrainer(row())).toBeNull();
    expect(toPublicTeam(coach())).toBeNull();
  });

  it("hides a hidden trainer and one who works with kids or teens", () => {
    expect(toPublicTrainer(coach({ hidden_at: "2026-10-01T00:00:00Z" }))).toBeNull();
    expect(toPublicTrainer(coach({ age_groups: ["youth"] }))).toBeNull();
    expect(toPublicTrainer(coach({ age_groups: ["adult", "teen"] }))).toBeNull();
  });
});
