import { describe, expect, it } from "vitest";
import {
  deriveLegacyFields,
  formatAvailabilityWindow,
  formatSlot,
  isAllDaySlot,
  nextOccurrence,
  normalizeSlots,
  parseTimeSlots,
  slotsHitRange,
  summarizeSlots,
  toDateKey,
  type TimeSlot,
} from "./availability-timeslots";

describe("parseTimeSlots", () => {
  it("keeps well-formed date and weekday slots, drops junk", () => {
    const out = parseTimeSlots([
      { date: "2026-08-01", start: "08:00", end: "11:00" },
      { weekday: 3, start: "18:00", end: "20:00" },
      { date: "bad", start: "08:00", end: "11:00" },
      { date: "2026-08-02", start: "12:00", end: "11:00" },
      null,
    ]);
    expect(out).toEqual([
      { date: "2026-08-01", start: "08:00", end: "11:00" },
      { weekday: 3, start: "18:00", end: "20:00" },
    ]);
  });
});

describe("normalizeSlots", () => {
  it("merges overlapping windows on the same date", () => {
    const out = normalizeSlots([
      { date: "2026-08-01", start: "08:00", end: "10:00" },
      { date: "2026-08-01", start: "09:30", end: "12:00" },
    ]);
    expect(out).toEqual([{ date: "2026-08-01", start: "08:00", end: "12:00" }]);
  });
  it("keeps disjoint windows", () => {
    const out = normalizeSlots([
      { date: "2026-08-01", start: "08:00", end: "10:00" },
      { date: "2026-08-01", start: "18:00", end: "20:00" },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("deriveLegacyFields", () => {
  it("derives range and weekday labels", () => {
    const slots: TimeSlot[] = [
      { date: "2026-08-05", start: "08:00", end: "10:00" },
      { date: "2026-08-01", start: "08:00", end: "10:00" },
      { weekday: 6, start: "09:00", end: "11:00" },
    ];
    expect(deriveLegacyFields(slots)).toEqual({
      starts_on: "2026-08-01",
      ends_on: "2026-08-05",
      recurring_days: ["Sat"],
    });
  });
});

describe("nextOccurrence", () => {
  it("skips windows that already ended today", () => {
    const now = new Date(2026, 7, 1, 12, 0);
    const next = nextOccurrence(
      [
        { date: toDateKey(now), start: "08:00", end: "10:00" },
        { date: toDateKey(now), start: "18:00", end: "20:00" },
      ],
      now,
    );
    expect(next?.start).toBe("18:00");
  });
  it("resolves weekly windows forward", () => {
    const now = new Date(2026, 7, 1, 12, 0); // Saturday
    const next = nextOccurrence([{ weekday: 1, start: "18:00", end: "20:00" }], now);
    expect(next?.dateKey).toBe("2026-08-03");
  });
});

describe("slotsHitRange", () => {
  it("matches a weekly window inside the range", () => {
    expect(slotsHitRange([{ weekday: 0, start: "08:00", end: "10:00" }], "2026-08-01", "2026-08-07")).toBe(true);
  });
  it("returns false when nothing lands in range", () => {
    expect(slotsHitRange([{ date: "2026-09-01", start: "08:00", end: "10:00" }], "2026-08-01", "2026-08-07")).toBe(false);
  });
});

describe("formatting", () => {
  it("formats a slot and a summary", () => {
    expect(formatSlot({ weekday: 6, start: "08:00", end: "11:30" })).toBe("Sat 8 AM–11:30 AM");
    expect(summarizeSlots([{ date: "2026-08-01", start: "08:00", end: "10:00" }])).toContain("1 date");
  });
});

describe("all-day slots", () => {
  const TIME_RE = /\d{1,2}(:\d{2})?\s?(AM|PM)/;

  it("isAllDaySlot detects preset and literal full-day windows", () => {
    expect(isAllDaySlot({ start: "08:00", end: "22:00" })).toBe(true);
    expect(isAllDaySlot({ start: "00:00", end: "24:00" })).toBe(true);
    expect(isAllDaySlot({ start: "00:00", end: "23:59" })).toBe(true);
    expect(isAllDaySlot({ start: "08:00", end: "11:00" })).toBe(false);
  });

  it("formatSlot shows All day with no times", () => {
    const label = formatSlot({ date: "2026-09-12", start: "08:00", end: "22:00" });
    expect(label).toContain("All day");
    expect(label).not.toMatch(TIME_RE);
  });

  it("summarizeSlots keeps all-day slots time-free", () => {
    const label = summarizeSlots([
      { date: "2026-09-12", start: "08:00", end: "22:00" },
      { date: "2026-09-13", start: "00:00", end: "24:00" },
    ]);
    expect(label).toContain("All day");
    expect(label).not.toMatch(TIME_RE);
  });

  it("mixed lists keep times on timed slots only", () => {
    const label = summarizeSlots([
      { date: "2026-09-12", start: "08:00", end: "22:00" },
      { date: "2026-09-13", start: "18:00", end: "20:00" },
    ]);
    expect(label).toContain("All day");
    expect(label).toContain("6 PM–8 PM");
  });

  it("formatAvailabilityWindow shows Next without times for all-day slots", () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    const key = toDateKey(future);
    const label = formatAvailabilityWindow({
      time_slots: [{ date: key, start: "08:00", end: "22:00" }],
    });
    expect(label).toContain("Next:");
    expect(label).toContain("All day");
    expect(label).not.toMatch(TIME_RE);
  });
});
