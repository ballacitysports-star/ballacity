import { describe, expect, it } from "vitest";
import {
  LISTING_COPY,
  LISTING_KINDS,
  LISTING_TABLE,
  hideErrorMessage,
  visibilityAction,
  visibilityOf,
} from "./listing-visibility";

describe("visibilityOf", () => {
  it("reads the two hide columns", () => {
    expect(visibilityOf({})).toEqual({ ownerHidden: false, moderatorHidden: false });
    expect(visibilityOf({ owner_hidden_at: "2026-10-23T10:00:00Z" })).toEqual({
      ownerHidden: true,
      moderatorHidden: false,
    });
    expect(
      visibilityOf({ owner_hidden_at: null, moderator_hidden_at: "2026-10-23T10:00:00Z" }),
    ).toEqual({
      ownerHidden: false,
      moderatorHidden: true,
    });
  });
});

describe("visibilityAction", () => {
  it("offers hide when public, show when the owner hid it", () => {
    expect(visibilityAction({ ownerHidden: false, moderatorHidden: false })).toBe("hide");
    expect(visibilityAction({ ownerHidden: true, moderatorHidden: false })).toBe("show");
  });

  it("offers nothing when moderators hid it, even if the owner did too", () => {
    expect(visibilityAction({ ownerHidden: false, moderatorHidden: true })).toBe("held");
    expect(visibilityAction({ ownerHidden: true, moderatorHidden: true })).toBe("held");
  });
});

describe("kinds", () => {
  it("covers games, posts, teams, trainer profiles and gyms, each with a table and words", () => {
    expect([...LISTING_KINDS].sort()).toEqual(["game", "gym", "post", "team", "trainer"]);
    for (const k of LISTING_KINDS) {
      expect(LISTING_TABLE[k]).toBeTruthy();
      expect(LISTING_COPY[k].noun).toBeTruthy();
      expect(LISTING_COPY[k].whoStillSees).toBeTruthy();
    }
    // A trainer profile is a `teams` row of kind 'coach'.
    expect(LISTING_TABLE.trainer).toBe(LISTING_TABLE.team);
  });

  it("says that hiding a game does not cancel it", () => {
    expect(LISTING_COPY.game.extra).toMatch(/does not cancel/i);
  });
});

describe("hideErrorMessage", () => {
  it("turns database errors into a sentence", () => {
    expect(hideErrorMessage("LISTING_NOT_FOUND")).toMatch(/can't change/);
    expect(hideErrorMessage("permission denied for function set_listing_hidden")).toMatch(
      /can't change/,
    );
    expect(hideErrorMessage("NOT_AUTHENTICATED")).toMatch(/Sign in/);
    expect(hideErrorMessage("boom")).toMatch(/Try again/);
  });

  it("never repeats the raw database message", () => {
    expect(hideErrorMessage("relation public.teams does not exist")).not.toMatch(/relation/);
  });
});
