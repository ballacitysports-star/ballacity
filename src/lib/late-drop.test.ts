import { describe, expect, it } from "vitest";
import { isLateDrop, lateDropWarning, LATE_DROP_WINDOW_MINUTES } from "./late-drop";

const NOW = Date.parse("2026-10-06T16:00:00Z");
const minutesFromNow = (m: number) => new Date(NOW + m * 60_000).toISOString();

describe("isLateDrop", () => {
  it("flags a drop inside the 2 hour window", () => {
    expect(isLateDrop({ startsAt: minutesFromNow(90), now: NOW })).toBe(true);
    expect(isLateDrop({ startsAt: minutesFromNow(LATE_DROP_WINDOW_MINUTES), now: NOW })).toBe(true);
  });

  it("allows an early drop", () => {
    expect(isLateDrop({ startsAt: minutesFromNow(LATE_DROP_WINDOW_MINUTES + 1), now: NOW })).toBe(
      false,
    );
    expect(isLateDrop({ startsAt: minutesFromNow(60 * 24), now: NOW })).toBe(false);
  });

  it("treats a game that already started as a late drop", () => {
    expect(isLateDrop({ startsAt: minutesFromNow(-15), now: NOW })).toBe(true);
  });

  it("never flags all-day games or missing / invalid start times", () => {
    expect(isLateDrop({ startsAt: minutesFromNow(30), allDay: true, now: NOW })).toBe(false);
    expect(isLateDrop({ startsAt: null, now: NOW })).toBe(false);
    expect(isLateDrop({ startsAt: "not a date", now: NOW })).toBe(false);
  });
});

describe("lateDropWarning", () => {
  it("warns that the squad is left short and the drop is recorded", () => {
    expect(lateDropWarning(minutesFromNow(30), NOW)).toBe(
      "This game starts in less than 2 hours. Dropping out now leaves your squad short and will be noted on your attendance profile.",
    );
  });

  it("says so when the game has already started", () => {
    expect(lateDropWarning(minutesFromNow(-5), NOW)).toContain("already started");
  });
});
