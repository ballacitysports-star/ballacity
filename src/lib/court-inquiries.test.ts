import { describe, expect, it } from "vitest";
import { formatInquiryWhen, isRequestableDate, validateCourtInquiry } from "@/lib/court-inquiries";

const NOW = new Date("2026-10-06T12:00:00Z").getTime();
const base = {
  orgId: "7e6740dd-ed43-4139-85b1-6ca42b3accfe",
  sport: "Basketball",
  courtType: "indoor",
  date: "2026-10-10",
  startTime: "18:00",
  durationMin: 120,
  playerCount: 10,
};

describe("court inquiry validation", () => {
  it("accepts a complete request", () => {
    expect(validateCourtInquiry(base)).toBeNull();
    expect(validateCourtInquiry({ ...base, notes: "weekly" })).toBeNull();
  });

  it("rejects bad times, sizes and lengths", () => {
    expect(validateCourtInquiry({ ...base, startTime: "25:00" })).not.toBeNull();
    expect(validateCourtInquiry({ ...base, playerCount: 0 })).not.toBeNull();
    expect(validateCourtInquiry({ ...base, durationMin: 10 })).not.toBeNull();
    expect(validateCourtInquiry({ ...base, courtType: "pool" })).not.toBeNull();
    expect(validateCourtInquiry({ ...base, sport: "  " })).not.toBeNull();
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

  it("formats a stored inquiry for managers (time may carry seconds)", () => {
    expect(formatInquiryWhen("2026-10-10", "18:00:00", 120)).toBe("Sat, Oct 10 · 6 PM · 2 hours");
    expect(formatInquiryWhen("2026-10-10", "09:30", 90)).toBe("Sat, Oct 10 · 9:30 AM · 1.5 hours");
  });
});
