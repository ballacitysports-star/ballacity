import { describe, it, expect } from "vitest";
import {
  resolveDay,
  fromDateKey,
  type AvailabilityRule,
  type DayOverride,
} from "./availability-resolve";
import type { Slot } from "./availability-slots";

const VENUE_A = "Court A";
const VENUE_B = "Court B";

// A Wednesday
const DATE_KEY = "2026-08-05";
const DATE = fromDateKey(DATE_KEY);

describe("resolveDay venueFilter", () => {
  it("returns everything when venueFilter is null/empty", () => {
    const weekly: Slot[] = [
      { day: "wed", start: "09:00", end: "10:00", venue: VENUE_A },
      { day: "wed", start: "10:00", end: "11:00", venue: VENUE_B },
    ];
    expect(resolveDay(DATE, weekly, [], null)).toHaveLength(2);
    expect(resolveDay(DATE, weekly, [], "")).toHaveLength(2);
  });

  it("narrows weekly-tier windows to the matching venue", () => {
    const weekly: Slot[] = [
      { day: "wed", start: "09:00", end: "10:00", venue: VENUE_A },
      { day: "wed", start: "10:00", end: "11:00", venue: VENUE_B },
    ];
    const out = resolveDay(DATE, weekly, [], VENUE_A);
    expect(out.map((w) => w.start)).toEqual(["09:00"]);
    expect(out[0].venue).toBe(VENUE_A);
  });

  it("is case- and whitespace-insensitive", () => {
    const weekly: Slot[] = [
      { day: "wed", start: "09:00", end: "10:00", venue: VENUE_A },
      { day: "wed", start: "10:00", end: "11:00", venue: VENUE_B },
    ];
    const out = resolveDay(DATE, weekly, [], `  ${VENUE_B.toLowerCase()}  `);
    expect(out).toHaveLength(1);
    expect(out[0].venue).toBe(VENUE_B);
  });

  it("narrows rules-tier windows to the matching venue", () => {
    const rules: AvailabilityRule[] = [
      {
        id: "r1",
        weekdays: ["wed"],
        start: "14:00",
        end: "15:00",
        venue: VENUE_A,
        freq: "weekly",
        anchorDate: DATE_KEY,
      },
      {
        id: "r2",
        weekdays: ["wed"],
        start: "15:00",
        end: "16:00",
        venue: VENUE_B,
        freq: "weekly",
        anchorDate: DATE_KEY,
      },
    ];
    const out = resolveDay(DATE, [], [], { venueFilter: VENUE_A, rules });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: "14:00", venue: VENUE_A, source: "rule" });
  });

  it("narrows override-tier windows to the matching venue", () => {
    const overrides: DayOverride[] = [
      {
        date: DATE_KEY,
        windows: [
          { start: "08:00", end: "09:00", venue: VENUE_A },
          { start: "09:00", end: "10:00", venue: VENUE_B },
        ],
      },
    ];
    const out = resolveDay(DATE, [], overrides, VENUE_B);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: "09:00", venue: VENUE_B, source: "override" });
  });

  it("applies across merged weekly + rules tiers on the same day", () => {
    const weekly: Slot[] = [
      { day: "wed", start: "09:00", end: "10:00", venue: VENUE_A },
      { day: "wed", start: "10:00", end: "11:00", venue: VENUE_B },
    ];
    const rules: AvailabilityRule[] = [
      {
        id: "r1",
        weekdays: ["wed"],
        start: "14:00",
        end: "15:00",
        venue: VENUE_A,
        freq: "weekly",
        anchorDate: DATE_KEY,
      },
      {
        id: "r2",
        weekdays: ["wed"],
        start: "15:00",
        end: "16:00",
        venue: VENUE_B,
        freq: "weekly",
        anchorDate: DATE_KEY,
      },
    ];
    const out = resolveDay(DATE, weekly, [], { venueFilter: VENUE_A, rules });
    expect(out.map((w) => w.start).sort()).toEqual(["09:00", "14:00"]);
    for (const w of out) expect(w.venue).toBe(VENUE_A);
  });

  it("excludes windows without a venue when a filter is active", () => {
    const weekly: Slot[] = [
      { day: "wed", start: "09:00", end: "10:00", venue: VENUE_A },
      { day: "wed", start: "12:00", end: "13:00" }, // no venue
    ];
    const out = resolveDay(DATE, weekly, [], VENUE_A);
    expect(out).toHaveLength(1);
    expect(out[0].start).toBe("09:00");
  });

  it("returns empty when no window matches the filter", () => {
    const weekly: Slot[] = [{ day: "wed", start: "09:00", end: "10:00", venue: VENUE_A }];
    const out = resolveDay(DATE, weekly, [], "unknown venue");
    expect(out).toEqual([]);
  });
});
