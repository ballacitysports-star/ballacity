import { describe, expect, it } from "vitest";
import { summarizeReliability } from "./player-reliability";

describe("summarizeReliability", () => {
  it("shows a first-timer as new", () => {
    expect(summarizeReliability({ attended: 0, noShows: 0, lateDrops: 0 })).toEqual({
      tier: "new",
      percent: null,
      label: "First run on BallaCity",
    });
  });

  it("rates a perfect record as high reliability", () => {
    expect(summarizeReliability({ attended: 8, noShows: 0, lateDrops: 0 })).toEqual({
      tier: "high",
      percent: 100,
      label: "100% Attendance · 8 games",
    });
    expect(summarizeReliability({ attended: 1, noShows: 0, lateDrops: 0 }).label).toBe(
      "100% Attendance · 1 game",
    );
  });

  it("counts a late drop against attendance and flags caution", () => {
    expect(summarizeReliability({ attended: 4, noShows: 0, lateDrops: 1 })).toEqual({
      tier: "caution",
      percent: 80,
      label: "80% Attendance · 1 late drop",
    });
  });

  it("lists no-shows and late drops together", () => {
    expect(summarizeReliability({ attended: 3, noShows: 1, lateDrops: 2 }).label).toBe(
      "50% Attendance · 2 late drops, 1 no-show",
    );
  });

  it("keeps a single miss in a long record at high reliability", () => {
    expect(summarizeReliability({ attended: 9, noShows: 0, lateDrops: 1 }).tier).toBe("high");
  });

  it("is caution (not new) when the only history is misses", () => {
    expect(summarizeReliability({ attended: 0, noShows: 0, lateDrops: 1 })).toMatchObject({
      tier: "caution",
      percent: 0,
    });
  });
});
