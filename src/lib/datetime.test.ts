import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  buildIcs,
  dateKeyInZone,
  daysBetweenKeys,
  findConflicts,
  formatCountdown,
  formatDuration,
  formatEventWhen,
  formatRelativeDay,
  formatTimeRange,
  googleCalendarUrl,
  intervalsOverlap,
  monthGridKeys,
  resolveDeadline,
  resolveTimeZone,
  timeKeyInZone,
  viewerTimeNote,
  whenDurationMin,
  whenSpansDays,
  zonedTimeToInstant,
  zoneOffsetMin,
} from "./datetime";

const NY = "America/New_York";
const LA = "America/Los_Angeles";

describe("zones", () => {
  it("falls back for invalid zones", () => {
    expect(resolveTimeZone("Not/AZone")).toBeTruthy();
    expect(resolveTimeZone(NY)).toBe(NY);
  });

  it("reads calendar fields in a zone", () => {
    // 2026-09-05T23:30Z is still Sep 5 in NY, Sep 5 in LA.
    const iso = "2026-09-05T23:30:00Z";
    expect(dateKeyInZone(iso, NY)).toBe("2026-09-05");
    expect(timeKeyInZone(iso, NY)).toBe("19:30");
    expect(timeKeyInZone(iso, LA)).toBe("16:30");
  });

  it("knows DST offsets", () => {
    expect(zoneOffsetMin("2026-07-01T12:00:00Z", NY)).toBe(-240);
    expect(zoneOffsetMin("2026-01-01T12:00:00Z", NY)).toBe(-300);
  });

  it("round-trips wall clock time in a zone", () => {
    const at = zonedTimeToInstant("2026-09-05", "18:00", NY);
    expect(dateKeyInZone(at, NY)).toBe("2026-09-05");
    expect(timeKeyInZone(at, NY)).toBe("18:00");
  });
});

describe("date keys", () => {
  it("shifts days across month boundaries", () => {
    expect(addDaysToKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysToKey("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("measures day gaps", () => {
    expect(daysBetweenKeys("2026-09-05", "2026-09-08")).toBe(3);
  });

  it("builds padded month grids", () => {
    const cells = monthGridKeys(2026, 8); // September 2026
    expect(cells.length % 7).toBe(0);
    expect(cells.filter(Boolean)).toHaveLength(30);
  });
});

describe("windows", () => {
  const when = {
    start: "2026-09-05T22:00:00Z", // 6pm NY
    end: "2026-09-05T23:30:00Z",
    timezone: NY,
  };

  it("computes duration", () => {
    expect(whenDurationMin(when)).toBe(90);
  });

  it("defaults duration when end is missing", () => {
    expect(whenDurationMin({ start: when.start, timezone: NY })).toBe(90);
  });

  it("detects multi-day windows", () => {
    expect(whenSpansDays(when)).toBe(false);
    expect(
      whenSpansDays({ start: when.start, end: "2026-09-06T05:00:00Z", timezone: NY }),
    ).toBe(true);
  });
});

describe("labels", () => {
  const now = new Date("2026-09-05T15:00:00Z");

  it("formats relative days", () => {
    expect(formatRelativeDay("2026-09-05T22:00:00Z", NY, now)).toBe("Today");
    expect(formatRelativeDay("2026-09-06T22:00:00Z", NY, now)).toBe("Tomorrow");
  });

  it("collapses the repeated meridiem in ranges", () => {
    expect(formatTimeRange("2026-09-05T22:00:00Z", "2026-09-05T23:30:00Z", NY)).toBe(
      "6:00 – 7:30 PM",
    );
  });

  it("formats durations", () => {
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(1440)).toBe("All day");
  });

  it("renders the canonical when line with the zone", () => {
    const label = formatEventWhen(
      { start: "2026-09-05T22:00:00Z", end: "2026-09-05T23:30:00Z", timezone: NY },
      { now },
    );
    expect(label).toBe("Today · 6:00 – 7:30 PM EDT · 1h 30m");
  });

  it("renders all-day events", () => {
    const label = formatEventWhen(
      { start: "2026-09-05T04:00:00Z", allDay: true, timezone: NY },
      { now },
    );
    expect(label).toContain("All day");
  });

  it("counts down", () => {
    expect(formatCountdown("2026-09-05T18:00:00Z", now)).toBe("3h 0m");
    expect(formatCountdown("2026-09-05T14:00:00Z", now)).toBe("");
  });

  it("adds a viewer-time note only across zones", () => {
    const when = { start: "2026-09-05T22:00:00Z", end: "2026-09-05T23:30:00Z", timezone: NY };
    expect(viewerTimeNote(when, NY)).toBe("");
    expect(viewerTimeNote(when, LA)).toBe("3:00 – 4:30 PM your time");
  });
});

describe("deadlines", () => {
  const when = { start: "2026-09-05T22:00:00Z", timezone: NY };

  it("resolves relative deadlines", () => {
    const at = resolveDeadline(when, { kind: "relative", minutesBefore: 120 });
    expect(at?.toISOString()).toBe("2026-09-05T20:00:00.000Z");
  });

  it("resolves none", () => {
    expect(resolveDeadline(when, { kind: "none" })).toBeNull();
  });
});

describe("conflicts", () => {
  it("finds overlapping windows", () => {
    const a = { start: "2026-09-05T22:00:00Z", end: "2026-09-05T23:30:00Z" };
    const b = { start: "2026-09-05T23:00:00Z", end: "2026-09-06T00:00:00Z" };
    const c = { start: "2026-09-06T22:00:00Z", end: "2026-09-06T23:00:00Z" };
    expect(findConflicts(a, [b, c])).toEqual([b]);
    expect(intervalsOverlap({ start: 0, end: 5 }, { start: 5, end: 9 })).toBe(false);
  });
});

describe("calendar export", () => {
  const event = {
    start: "2026-09-05T22:00:00Z",
    end: "2026-09-05T23:30:00Z",
    timezone: NY,
    title: "Pickup, Run",
    location: "Rucker Park",
  };

  it("builds a valid ics document in the viewer's zone", () => {
    const ics = buildIcs({ ...event, viewerTimeZone: NY });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("X-WR-TIMEZONE:America/New_York");
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:America/New_York");
    // 22:00Z is 18:00 in New York (EDT).
    expect(ics).toContain("DTSTART;TZID=America/New_York:20260905T180000");
    expect(ics).toContain("DTEND;TZID=America/New_York:20260905T193000");
    expect(ics).toContain("SUMMARY:Pickup\\, Run");
    expect(ics.endsWith("END:VCALENDAR")).toBe(true);
  });

  it("builds a google calendar link in the viewer's zone", () => {
    const url = googleCalendarUrl({ ...event, viewerTimeZone: NY });
    expect(url).toContain("20260905T220000Z%2F20260905T233000Z");
    expect(url).toContain("ctz=America%2FNew_York");
  });

});

describe("all-day calendar exports", () => {
  const allDay = {
    title: "Open Run Day",
    start: "2026-09-01T04:00:00.000Z",
    end: "2026-09-01T04:00:00.000Z",
    allDay: true,
    timezone: "America/New_York",
    viewerTimeZone: "America/New_York",
  };

  it("emits date-only DTSTART/DTEND with exclusive end and no times", () => {
    const ics = buildIcs(allDay);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260901");
    expect(ics).toContain("DTEND;VALUE=DATE:20260902");
    expect(ics).toContain("X-MICROSOFT-CDO-ALLDAYEVENT:TRUE");
    expect(ics).not.toMatch(/DTSTART;TZID/);
    expect(ics).not.toContain("BEGIN:VTIMEZONE");
  });

  it("keeps multi-day all-day blocks inclusive of the last day", () => {
    const ics = buildIcs({ ...allDay, end: "2026-09-04T04:00:00.000Z" });
    expect(ics).toContain("DTSTART;VALUE=DATE:20260901");
    expect(ics).toContain("DTEND;VALUE=DATE:20260904");
  });

  it("uses date-only ranges for Google and Outlook links", () => {
    expect(googleCalendarUrl(allDay)).toContain("dates=20260901%2F20260902");
    const outlook = outlookCalendarUrl(allDay);
    expect(outlook).toContain("allday=true");
    expect(outlook).toContain("startdt=2026-09-01");
    expect(outlook).toContain("enddt=2026-09-02");
  });
});
