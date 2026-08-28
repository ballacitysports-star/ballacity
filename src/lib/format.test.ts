import { describe, expect, it } from "vitest";
import { formatGameEnds, formatGameWhen, formatNotificationWhen, formatWhenDate } from "./format";

const TIME_RE = /\d{1,2}:\d{2}/;

describe("formatGameWhen", () => {
  const iso = "2026-09-05T22:00:00Z";

  it("shows a clock time for timed games", () => {
    expect(formatGameWhen({ date: iso })).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/);
  });

  it("never shows a clock time for all-day games", () => {
    const label = formatGameWhen({ date: iso, allDay: true });
    expect(label).toContain("All day");
    expect(label).not.toMatch(TIME_RE);
  });

  it("treats null allDay as timed", () => {
    expect(formatGameWhen({ date: iso, allDay: null })).toMatch(TIME_RE);
  });
});

describe("formatGameEnds", () => {
  const start = "2026-09-05T22:00:00Z";
  const end = "2026-09-06T01:00:00Z";

  it("shows the end date and time for timed games", () => {
    expect(formatGameEnds({ date: start, endsAt: end })).toMatch(TIME_RE);
  });

  it("derives the end from duration when endsAt is missing", () => {
    expect(formatGameEnds({ date: start, duration: "2h" })).toMatch(TIME_RE);
  });

  it("shows only the end date for all-day games", () => {
    const label = formatGameEnds({ date: start, endsAt: end, allDay: true });
    expect(label).not.toMatch(TIME_RE);
    expect(label).toBe(formatWhenDate(end));
  });

  it("falls back to the start date for all-day games with no end", () => {
    const label = formatGameEnds({ date: start, allDay: true });
    expect(label).not.toMatch(TIME_RE);
    expect(label).toBe(formatWhenDate(start));
  });

  it("falls back to the raw length text when no end can be computed", () => {
    expect(formatGameEnds({ date: start, duration: "TBD" })).toBe("TBD");
  });
});

describe("formatNotificationWhen", () => {
  const iso = "2026-09-05T22:00:00Z";

  it("includes the time for timed games", () => {
    expect(formatNotificationWhen({ date: iso })).toMatch(TIME_RE);
  });

  it("shows date only for all-day games", () => {
    const label = formatNotificationWhen({ date: iso, allDay: true });
    expect(label).not.toMatch(TIME_RE);
    expect(label).toContain("all day");
  });
});
