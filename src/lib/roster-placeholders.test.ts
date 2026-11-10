import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rosterPlaceholderCount } from "./roster-placeholders";

describe("rosterPlaceholderCount (game page roster strip)", () => {
  it("gives a viewer who cannot read the roster one chip per place taken", () => {
    // A signed-in stranger or a pending requester on a 9/10 game: RLS returns no rows.
    expect(
      rosterPlaceholderCount({
        takenPlaces: 9,
        viewerHoldsPlace: false,
        namedOthers: 0,
        rosterLoading: false,
        canReadRoster: false,
      }),
    ).toBe(9);
  });

  it("draws none for the host or a player once the roster has loaded, so a removal leaves no ghost", () => {
    expect(
      rosterPlaceholderCount({
        takenPlaces: 4,
        viewerHoldsPlace: true,
        namedOthers: 3,
        rosterLoading: false,
        canReadRoster: true,
      }),
    ).toBe(0);
    // The live count still includes a player the host just removed; the roster no longer does.
    expect(
      rosterPlaceholderCount({
        takenPlaces: 5,
        viewerHoldsPlace: true,
        namedOthers: 3,
        rosterLoading: false,
        canReadRoster: true,
      }),
    ).toBe(0);
  });

  it("stands in for the places a roster still loading will fill, without counting the viewer twice", () => {
    expect(
      rosterPlaceholderCount({
        takenPlaces: 6,
        viewerHoldsPlace: true,
        namedOthers: 0,
        rosterLoading: true,
        canReadRoster: false,
      }),
    ).toBe(5);
  });

  it("never goes negative", () => {
    expect(
      rosterPlaceholderCount({
        takenPlaces: 1,
        viewerHoldsPlace: true,
        namedOthers: 2,
        rosterLoading: true,
        canReadRoster: false,
      }),
    ).toBe(0);
  });
});

describe("wiring", () => {
  it("the game page draws placeholders from the roster's own loading state, not from the count being known", () => {
    const src = readFileSync("src/routes/games.$gameId.index.tsx", "utf8");
    expect(src).toContain("loading: rosterLoading,");
    expect(src).toMatch(/rosterPlaceholderCount\(\{[\s\S]*?rosterLoading,[\s\S]*?canReadRoster:/);
    expect(src).not.toContain("const rosterHydrated = liveParticipantCount !== undefined;");
  });

  it("the pay page warns only a viewer without a place or a payment", () => {
    const src = readFileSync("src/routes/games.$gameId.pay.tsx", "utf8");
    expect(src).toMatch(
      /justFilledDuringPay = showFilledUpWarning\(\{[\s\S]*?viewerHoldsPlace,[\s\S]*?hasSubmission,/,
    );
    expect(src).not.toContain(
      "const justFilledDuringPay = liveCount !== undefined && spotsLeft <= 0;",
    );
  });
});
