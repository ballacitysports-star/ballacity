import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_EDIT_SCHEMA,
  availabilityColumns,
  GAME_EDIT_SCHEMA,
  TRYOUT_EDIT_SCHEMA,
  changedFields,
  gameSideEffects,
  listingStatus,
  liveLink,
  sportFromSearch,
} from "./live-listings";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const future = "2026-10-20T18:00:00Z";
const past = "2026-10-01T18:00:00Z";

describe("listingStatus", () => {
  const game = { date: future, joined: 4, max_players: 10, joins_closed: false };

  it("puts hidden first, then lifecycle, then capacity for games", () => {
    expect(listingStatus("games", game, NOW)).toBe("active");
    expect(listingStatus("games", { ...game, hidden_at: past, status: "cancelled" }, NOW)).toBe(
      "hidden",
    );
    expect(listingStatus("games", { ...game, cancelled_at: past }, NOW)).toBe("cancelled");
    expect(listingStatus("games", { ...game, date: past }, NOW)).toBe("completed");
    // A game still running (ends later) is not over yet.
    expect(listingStatus("games", { ...game, date: past, ends_at: future }, NOW)).toBe("active");
    expect(listingStatus("games", { ...game, joined: 10 }, NOW)).toBe("full");
    expect(listingStatus("games", { ...game, joins_closed: true }, NOW)).toBe("joins_closed");
  });

  it("treats a held or unscreened team post as not live", () => {
    const post = { event_date: future, moderation_status: "approved" };
    expect(listingStatus("tryouts", post, NOW)).toBe("active");
    expect(listingStatus("tryouts", { ...post, moderation_status: "held" }, NOW)).toBe("held");
    expect(listingStatus("tryouts", { ...post, moderation_status: "pending" }, NOW)).toBe(
      "screening",
    );
    expect(
      listingStatus("tryouts", { ...post, moderation_status: "held", hidden_at: past }, NOW),
    ).toBe("hidden");
  });

  it("reads tryouts and availability", () => {
    expect(listingStatus("tryouts", { event_date: past }, NOW)).toBe("completed");
    expect(
      listingStatus("tryouts", { event_date: future, spots_max: 5, spots_taken: 5 }, NOW),
    ).toBe("full");
    expect(listingStatus("tryouts", { event_date: null, spots_max: null }, NOW)).toBe("active");
    expect(listingStatus("availability", { status: "closed" }, NOW)).toBe("closed");
    expect(listingStatus("availability", { status: "open", ends_on: "2026-10-14" }, NOW)).toBe(
      "active",
    );
    expect(listingStatus("availability", { status: "open", ends_on: "2026-10-13" }, NOW)).toBe(
      "completed",
    );
  });
});

describe("links and search", () => {
  it("points at the page players see", () => {
    expect(liveLink("games", { id: "g1" })).toBe("/games/g1");
    expect(liveLink("tryouts", { id: "t1" })).toBe("/tryouts/t1");
    expect(liveLink("availability", { id: "a1", user_id: "u1" })).toBe("/players/u1");
  });

  it("recognises a sport name in any case", () => {
    expect(sportFromSearch("basketball")).toBe("Basketball");
    expect(sportFromSearch("ball")).toBeNull();
  });
});

describe("edits", () => {
  it("rejects bad values and the non-existent 'camp' kind", () => {
    expect(GAME_EDIT_SCHEMA.safeParse({ max_players: 0 }).success).toBe(false);
    expect(GAME_EDIT_SCHEMA.safeParse({ date: "not a date" }).success).toBe(false);
    expect(TRYOUT_EDIT_SCHEMA.safeParse({ kind: "camp" }).success).toBe(false);
    expect(TRYOUT_EDIT_SCHEMA.safeParse({ kind: "clinic" }).success).toBe(true);
    expect(AVAILABILITY_EDIT_SCHEMA.safeParse({ status: "active" }).success).toBe(false);
    expect(AVAILABILITY_EDIT_SCHEMA.safeParse({ sports: [] }).success).toBe(false);
    expect(AVAILABILITY_EDIT_SCHEMA.safeParse({ looking_for: ["coach"] }).success).toBe(false);
    expect(AVAILABILITY_EDIT_SCHEMA.safeParse({ looking_for: ["guest", "tryout"] }).success).toBe(
      true,
    );
  });

  it("treats the same instant in another format as unchanged", () => {
    const before = { date: "2026-10-20T18:00:00+00:00", title: "Run" };
    expect(changedFields(before, { date: "2026-10-20T18:00:00.000Z", title: "Run" })).toEqual({});
    expect(changedFields(before, { date: "2026-10-20T19:00:00.000Z" })).toEqual({
      date: "2026-10-20T19:00:00.000Z",
    });
  });

  it("ignores key order when comparing jsonb read back from the database", () => {
    const before = { skill_levels: { Soccer: "High School", Basketball: "Rec League" } };
    expect(
      changedFields(before, { skill_levels: { Basketball: "Rec League", Soccer: "High School" } }),
    ).toEqual({});
  });

  it("shifts a fixed end with the start and drops the pin when the address changes", () => {
    const before = {
      date: "2026-10-20T18:00:00Z",
      ends_at: "2026-10-20T20:00:00Z",
      lat: 1,
      lng: 2,
    };
    expect(gameSideEffects(before, { date: "2026-10-21T18:00:00Z" })).toEqual({
      ends_at: "2026-10-21T20:00:00.000Z",
    });
    expect(gameSideEffects(before, { location: "New Court" })).toEqual({ lat: null, lng: null });
    expect(gameSideEffects({ ...before, ends_at: null }, { date: future })).toEqual({});
  });
});

describe("availabilityColumns", () => {
  const before = {
    sports: ["Basketball", "Soccer"],
    skill_level: "Rec League",
    skill_levels: { Basketball: "Rec League · High School", Soccer: "Club / Travel" },
  };

  it("saves edited levels as skill_levels and the primary sport's skill_level", () => {
    expect(
      availabilityColumns(before, {
        levels: { Basketball: ["AAU / Travel"], Soccer: ["High School"] },
        note: "x",
      }),
    ).toEqual({
      note: "x",
      skill_level: "AAU / Travel",
      skill_levels: { Basketball: "AAU / Travel", Soccer: "High School" },
    });
  });

  it("keeps existing levels when only sports change, dropping a removed sport's", () => {
    expect(availabilityColumns(before, { sports: ["Soccer"] })).toEqual({
      sports: ["Soccer"],
      skill_level: "Club / Travel",
      skill_levels: { Soccer: "Club / Travel" },
    });
  });

  it("falls back to skill_level on a post saved before skill_levels existed", () => {
    const legacy = { sports: ["Basketball"], skill_level: "High School", skill_levels: {} };
    expect(availabilityColumns(legacy, { sports: ["Basketball", "Soccer"] })).toEqual({
      sports: ["Basketball", "Soccer"],
      skill_level: "High School",
      skill_levels: { Basketball: "High School" },
    });
  });

  it("leaves level columns alone when neither sports nor levels change", () => {
    expect(availabilityColumns(before, { city: "Austin" })).toEqual({ city: "Austin" });
  });
});
