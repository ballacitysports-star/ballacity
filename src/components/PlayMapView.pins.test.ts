import { describe, expect, it } from "vitest";
import { mapPinsFromGames } from "./PlayMapView";

const emoji = { basketball: "🏀" };

describe("map pins for games", () => {
  it("marks games the viewer may not see the exact venue of as approximate", () => {
    const pins = mapPinsFromGames(
      [
        {
          id: "youth",
          sport: "basketball",
          lat: 33.77,
          lng: -84.3,
          locationPrecision: "approximate",
        },
        {
          id: "mine",
          sport: "basketball",
          lat: 33.77412,
          lng: -84.29631,
          locationPrecision: "exact",
        },
        { id: "adult", sport: "basketball", lat: 33.5, lng: -84.1 },
      ],
      emoji,
    );
    expect(pins.find((p) => p.id === "youth")?.approximate).toBe(true);
    expect(pins.find((p) => p.id === "mine")?.approximate).toBe(false);
    expect(pins.find((p) => p.id === "adult")?.approximate).toBe(false);
  });

  it("never invents a pin for a game without coordinates", () => {
    expect(
      mapPinsFromGames([{ id: "x", sport: "basketball", lat: null, lng: null }], emoji),
    ).toEqual([]);
  });

  it("only ever carries the coordinates it was given (no exact data is added)", () => {
    const [pin] = mapPinsFromGames(
      [
        {
          id: "youth",
          sport: "basketball",
          lat: 33.77,
          lng: -84.3,
          locationPrecision: "approximate",
        },
      ],
      emoji,
    );
    expect([pin.lat, pin.lng]).toEqual([33.77, -84.3]);
  });
});
