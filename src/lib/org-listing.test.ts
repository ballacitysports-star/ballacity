import { describe, expect, it } from "vitest";
import { formatDayHours, parseHours, resolveOpenState } from "@/lib/org-hours";
import { scoreListing } from "@/lib/org-listing";

const tz = "UTC";
const at = (iso: string) => new Date(iso);

describe("org hours", () => {
  it("drops malformed ranges when parsing", () => {
    const h = parseHours({ "1": { ranges: [{ open: "9:00", close: "21:00" }, { open: "09:00", close: "21:00" }] } });
    expect(h["1"].ranges).toEqual([{ open: "09:00", close: "21:00" }]);
  });

  it("reports open during a normal range", () => {
    const h = parseHours({ "1": { ranges: [{ open: "09:00", close: "21:00" }] } });
    // Monday 12:00 UTC
    expect(resolveOpenState(h, tz, at("2026-01-05T12:00:00Z")).status).toBe("open");
  });

  it("flags closing soon within the last hour", () => {
    const h = parseHours({ "1": { ranges: [{ open: "09:00", close: "21:00" }] } });
    const s = resolveOpenState(h, tz, at("2026-01-05T20:30:00Z"));
    expect(s.status).toBe("open");
    expect(s.closingSoon).toBe(true);
  });

  it("handles overnight ranges past midnight", () => {
    const h = parseHours({ "1": { ranges: [{ open: "20:00", close: "02:00" }] } });
    // Tuesday 01:00 UTC — still inside Monday's overnight window
    expect(resolveOpenState(h, tz, at("2026-01-06T01:00:00Z")).status).toBe("open");
    expect(resolveOpenState(h, tz, at("2026-01-06T03:00:00Z")).status).toBe("closed");
  });

  it("treats explicit closed days as closed", () => {
    const h = parseHours({ "1": { closed: true } });
    expect(resolveOpenState(h, tz, at("2026-01-05T12:00:00Z")).status).toBe("closed");
    expect(formatDayHours(h["1"])).toBe("Closed");
  });

  it("returns unknown with no hours at all", () => {
    expect(resolveOpenState({}, tz).status).toBe("unknown");
  });
});

describe("listing strength", () => {
  const base = {
    name: "",
    handle: "",
    category: "",
    address: "",
    phone: "",
    email: "",
    website: "",
    bio: "",
    hours: {},
    amenities: [] as string[],
    photos: [] as string[],
    avatarUrl: "",
    coverUrl: "",
  };

  it("scores an empty listing at 0", () => {
    expect(scoreListing(base).percent).toBe(0);
  });

  it("scores a full listing at 100", () => {
    const full = scoreListing({
      ...base,
      name: "Peak Gym",
      handle: "peakgym",
      category: "Gym",
      address: "123 Main St, Austin, TX",
      phone: "5551234567",
      email: "hi@peak.com",
      website: "https://peak.com",
      bio: "A neighborhood gym with two full courts, weights, and open run nights.",
      hours: parseHours({ "1": { ranges: [{ open: "09:00", close: "21:00" }] } }),
      amenities: ["Parking", "Showers", "Lockers"],
      photos: ["a", "b", "c"],
      avatarUrl: "logo",
      coverUrl: "cover",
    });
    expect(full.percent).toBe(100);
    expect(full.missing).toHaveLength(0);
  });
});
