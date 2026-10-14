import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COURT_TYPES,
  INQUIRY_SPORTS,
  TIME_SLOTS,
  courtTypeLabel,
  formatInquiryWhen,
  isRequestableDate,
  validateCourtInquiry,
} from "@/lib/court-inquiries";

const NOW = new Date("2026-10-06T12:00:00Z").getTime();
const base = {
  orgId: "7e6740dd-ed43-4139-85b1-6ca42b3accfe",
  sport: "Basketball",
  courtType: "half_court",
  date: "2026-10-10",
  timeSlot: "evening",
  durationMin: 120,
  playerCount: 10,
};

describe("court inquiry options", () => {
  it("offers the sports, courts/areas and time slots the booking model calls for", () => {
    expect(INQUIRY_SPORTS).toEqual(["Basketball", "Volleyball", "Pickleball", "Soccer", "Other"]);
    expect(COURT_TYPES.map((c) => c.label)).toEqual([
      "No preference",
      "Full court",
      "Half court",
      "Turf",
      "Cage",
    ]);
    expect(TIME_SLOTS.map((t) => t.label)).toEqual([
      "Morning",
      "Afternoon",
      "Evening",
      "Specific time",
    ]);
  });

  it("still labels the older indoor/outdoor values", () => {
    expect(courtTypeLabel("indoor")).toBe("Indoor");
    expect(courtTypeLabel("outdoor")).toBe("Outdoor");
    expect(courtTypeLabel("cage")).toBe("Cage");
    expect(courtTypeLabel("nonsense")).toBe("No preference");
  });
});

describe("court inquiry validation", () => {
  // validateCourtInquiry reads the real clock; pin it so the fixed dates stay valid.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts a slot request without an exact time", () => {
    expect(validateCourtInquiry(base)).toBeNull();
    expect(validateCourtInquiry({ ...base, notes: "Team practice for 12 players" })).toBeNull();
  });

  it("requires an exact time only for 'Specific time', and rejects one for a slot", () => {
    expect(validateCourtInquiry({ ...base, timeSlot: "custom" })).not.toBeNull();
    expect(validateCourtInquiry({ ...base, timeSlot: "custom", startTime: "18:30" })).toBeNull();
    expect(
      validateCourtInquiry({ ...base, timeSlot: "custom", startTime: "25:00" }),
    ).not.toBeNull();
    expect(validateCourtInquiry({ ...base, startTime: "18:00" })).not.toBeNull();
  });

  it("rejects bad sports, courts, sizes and lengths", () => {
    expect(validateCourtInquiry({ ...base, sport: "Curling" })).not.toBeNull();
    expect(validateCourtInquiry({ ...base, courtType: "pool" })).not.toBeNull();
    expect(validateCourtInquiry({ ...base, playerCount: 0 })).not.toBeNull();
    expect(validateCourtInquiry({ ...base, durationMin: 10 })).not.toBeNull();
    expect(validateCourtInquiry({ ...base, notes: "x".repeat(501) })).not.toBeNull();
  });

  it("limits dates to today..one year out, with a day of timezone slack", () => {
    expect(isRequestableDate("2026-10-06", NOW)).toBe(true);
    expect(isRequestableDate("2026-10-05", NOW)).toBe(true);
    expect(isRequestableDate("2026-10-04", NOW)).toBe(false);
    expect(isRequestableDate("2027-10-06", NOW)).toBe(true);
    expect(isRequestableDate("2028-01-01", NOW)).toBe(false);
    expect(isRequestableDate("not-a-date", NOW)).toBe(false);
    expect(isRequestableDate("2026-13-40", NOW)).toBe(false);
  });
});

describe("formatInquiryWhen", () => {
  it("shows the part of day for a slot request", () => {
    expect(formatInquiryWhen("2026-10-10", null, 120, "evening")).toBe(
      "Sat, Oct 10 · Evening · 2 hours",
    );
  });

  it("shows the exact time for a specific-time request (time may carry seconds)", () => {
    expect(formatInquiryWhen("2026-10-10", "18:00:00", 120, "custom")).toBe(
      "Sat, Oct 10 · 6 PM · 2 hours",
    );
    expect(formatInquiryWhen("2026-10-10", "09:30", 90)).toBe("Sat, Oct 10 · 9:30 AM · 1.5 hours");
  });
});
