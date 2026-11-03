import { describe, expect, it } from "vitest";
import {
  COARSE_FALLBACK_LABEL,
  coarsenGame,
  coarsenRow,
  coarseCoordinate,
  coarseGameLabel,
  gameLocationView,
  isYouthInclusiveGame,
  notificationLocationText,
  redactForStorage,
  withExactLocation,
} from "./youth-game-location";

const base = {
  location: "Lincoln Park Court 3, 12 Main St",
  neighborhood: "Decatur",
  lat: 33.77412,
  lng: -84.29631,
};

describe("which games are youth-inclusive", () => {
  it("treats everything except an enforced adult-only range as youth-inclusive", () => {
    expect(isYouthInclusiveGame({ minAge: null, maxAge: null })).toBe(true);
    expect(isYouthInclusiveGame({ minAge: 13, maxAge: 17 })).toBe(true);
    expect(isYouthInclusiveGame({ minAge: 16, maxAge: 30 })).toBe(true);
    expect(isYouthInclusiveGame({ minAge: null, maxAge: 40 })).toBe(true);
    expect(isYouthInclusiveGame({ minAge: 21, maxAge: 18 })).toBe(true); // inverted: not adult-only
    expect(isYouthInclusiveGame({ minAge: 18, maxAge: null })).toBe(false);
    expect(isYouthInclusiveGame({ minAge: 21, maxAge: 40 })).toBe(false);
  });
});

describe("coarse form", () => {
  it("matches the database's coarse rule", () => {
    expect(coarseCoordinate(33.77412)).toBe(33.77);
    expect(coarseCoordinate("-84.29631")).toBe(-84.3);
    expect(coarseCoordinate(null)).toBeNull();
    expect(coarseGameLabel("  Decatur ")).toBe("Decatur");
    expect(coarseGameLabel("")).toBe(COARSE_FALLBACK_LABEL);
    expect(coarseGameLabel(undefined)).toBe(COARSE_FALLBACK_LABEL);
  });

  it("removes the venue and street from a youth-inclusive game", () => {
    const g = coarsenGame({ ...base, minAge: 13, maxAge: 17 });
    expect(g.location).toBe("Decatur");
    expect(g.lat).toBe(33.77);
    expect(g.lng).toBe(-84.3);
    expect(g.locationPrecision).toBe("approximate");
    expect(JSON.stringify(g)).not.toContain("Lincoln Park");
    expect(JSON.stringify(g)).not.toContain("12 Main");
  });

  it("treats a game with no age limit as youth-inclusive", () => {
    expect(coarsenGame({ ...base }).location).toBe("Decatur");
  });

  it("leaves an adult-only game exact", () => {
    const g = coarsenGame({ ...base, minAge: 18 });
    expect(g.location).toBe(base.location);
    expect(g.lat).toBe(base.lat);
    expect(g.locationPrecision).toBe("exact");
  });
});

describe("authorized overlay and storage", () => {
  const youth = coarsenGame({ ...base, minAge: 13, maxAge: 17 });
  it("shows the exact location only after the database released it", () => {
    const exact = withExactLocation(youth, {
      location: base.location,
      lat: base.lat,
      lng: base.lng,
    });
    expect(exact.location).toBe(base.location);
    expect(exact.locationPrecision).toBe("exact");
    expect(withExactLocation(youth, undefined)).toBe(youth);
  });

  it("never lets an exact youth-game location reach device storage", () => {
    const exact = withExactLocation(youth, {
      location: base.location,
      lat: base.lat,
      lng: base.lng,
    });
    const stored = redactForStorage(exact);
    expect(JSON.stringify(stored)).not.toContain("Lincoln Park");
    expect(JSON.stringify(stored)).not.toContain("33.774");
    expect(stored.locationPrecision).toBe("approximate");
  });

  it("does not overlay an adult-only game", () => {
    const adult = coarsenGame({ ...base, minAge: 21 });
    expect(withExactLocation(adult, { location: "x", lat: 1, lng: 2 })).toBe(adult);
  });
});

describe("server rows and notifications", () => {
  const row = {
    min_age: 13,
    max_age: 17,
    location: base.location,
    neighborhood: "Decatur",
    lat: 33.77412,
    lng: -84.29631,
  };
  it("coarsens a youth-inclusive row and leaves an adult-only row alone", () => {
    expect(coarsenRow(row).location).toBe("Decatur");
    expect(coarsenRow(row).lat).toBe(33.77);
    const adult = { ...row, min_age: 18, max_age: null };
    expect(coarsenRow(adult)).toBe(adult);
  });

  it("keeps the venue out of notification text for youth-inclusive games", () => {
    const text = notificationLocationText(row) ?? "";
    expect(text).not.toContain("Lincoln Park");
    expect(text).toContain("Open the game for the exact location");
    expect(
      notificationLocationText({ ...row, min_age: null, max_age: null, neighborhood: "" }),
    ).toBe("Open the game for the exact location");
    expect(notificationLocationText({ ...row, min_age: 18, max_age: null })).toBe(
      `Where: ${base.location}`,
    );
  });
});

describe("what the location block should show", () => {
  const youth = coarsenGame({ ...base, minAge: 13, maxAge: 17 });
  it("covers loading, denied, error and signed-out states", () => {
    expect(gameLocationView(youth, "loading", true).kind).toBe("loading");
    expect(gameLocationView(youth, "error", true).kind).toBe("error");
    expect(gameLocationView(youth, "ready", true)).toMatchObject({ kind: "approximate" });
    expect(gameLocationView(youth, "ready", false)).toMatchObject({
      kind: "approximate",
      note: expect.stringContaining("Sign in"),
    });
    const exact = withExactLocation(youth, { location: base.location, lat: 1, lng: 2 });
    expect(gameLocationView(exact, "ready", true).kind).toBe("exact");
    expect(gameLocationView(coarsenGame({ ...base, minAge: 18 }), "loading", true).kind).toBe(
      "exact",
    );
  });
});
