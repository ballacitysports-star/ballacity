import { describe, expect, it } from "vitest";
import { availabilityExpiresAt, listingFor, safeTimezone } from "./availability-lifecycle";

/**
 * The author's listing status (src/lib/availability-lifecycle.ts). These cases are the same as supabase/tests/850
 * section 5 (private_sec.availability_expires_at), so the author's view of "listed until" matches what the database does.
 */
describe("availabilityExpiresAt (mirrors the database rule)", () => {
  it("weekly: 14 days after confirmation", () => {
    expect(
      availabilityExpiresAt({
        status: "open",
        time_slots: [{ weekday: 1, start: "18:00", end: "20:00" }],
        last_confirmed_at: "2026-11-01T12:00:00Z",
      })?.toISOString(),
    ).toBe("2026-11-15T12:00:00.000Z");
  });

  it("dated: the end of the last slot, in the post's timezone", () => {
    expect(
      availabilityExpiresAt({
        status: "open",
        time_slots: [
          { date: "2026-11-20", start: "18:00", end: "20:00" },
          { date: "2026-11-21", start: "09:00", end: "11:00" },
        ],
        timezone: "America/New_York",
      })?.toISOString(),
    ).toBe("2026-11-21T16:00:00.000Z");
  });

  it("a slot ending at 24:00 ends at midnight local time", () => {
    expect(
      availabilityExpiresAt({
        status: "open",
        time_slots: [{ date: "2026-11-20", start: "18:00", end: "24:00" }],
        timezone: "America/Los_Angeles",
      })?.toISOString(),
    ).toBe("2026-11-21T08:00:00.000Z");
  });

  it("no or unknown timezone: New York", () => {
    expect(safeTimezone(null)).toBe("America/New_York");
    expect(safeTimezone("Mars/Olympus_Mons")).toBe("America/New_York");
    expect(
      availabilityExpiresAt({
        status: "open",
        time_slots: [{ date: "2026-11-20", start: "18:00", end: "20:00" }],
      })?.toISOString(),
    ).toBe("2026-11-21T01:00:00.000Z");
  });

  it("legacy dates: the end of the last day", () => {
    expect(
      availabilityExpiresAt({
        status: "open",
        time_slots: [],
        ends_on: "2026-11-03",
      })?.toISOString(),
    ).toBe("2026-11-04T05:00:00.000Z");
  });
});

describe("listingFor", () => {
  const now = new Date("2026-11-17T12:00:00Z");
  const weekly = (confirmed: string, status = "open") => ({
    status,
    time_slots: [{ weekday: 2, start: "18:00", end: "20:00" }],
    last_confirmed_at: confirmed,
  });

  it("a recently confirmed weekly post is listed, nothing to do", () => {
    const l = listingFor(weekly("2026-11-15T12:00:00Z"), now);
    expect(l.state).toBe("listed");
    expect(l.canReconfirm).toBe(false);
    expect(l.label).toMatch(/^Listed until /);
  });

  it("a weekly post within 3 days of running out asks to be confirmed", () => {
    const l = listingFor(weekly("2026-11-05T12:00:00Z"), now);
    expect(l).toMatchObject({ state: "listed", canReconfirm: true, needsAttention: true });
  });

  it("a weekly post past 14 days has run out and can be confirmed back", () => {
    const l = listingFor(weekly("2026-11-01T12:00:00Z"), now);
    expect(l).toMatchObject({ state: "ended", canReconfirm: true, needsAttention: true });
    expect(l.label).toContain("confirm");
  });

  it("server-marked expired counts as run out", () => {
    expect(listingFor(weekly("2026-11-16T12:00:00Z", "expired"), now).state).toBe("ended");
  });

  it("a dated post whose dates passed needs new dates, not a confirm", () => {
    const l = listingFor(
      { status: "open", time_slots: [{ date: "2026-11-10", start: "18:00", end: "20:00" }] },
      now,
    );
    expect(l).toMatchObject({ state: "ended", canReconfirm: false, needsAttention: true });
    expect(l.label).toContain("dates have passed");
  });

  it("paused, closed and guardian-closed say so and offer no confirm", () => {
    expect(listingFor(weekly("2026-11-01T12:00:00Z", "paused"), now)).toMatchObject({
      state: "paused",
      canReconfirm: false,
    });
    expect(listingFor(weekly("2026-11-16T12:00:00Z", "closed"), now).label).toBe(
      "Closed by BallaCity",
    );
    expect(listingFor(weekly("2026-11-16T12:00:00Z", "inactive"), now).state).toBe(
      "guardian_closed",
    );
  });
});
