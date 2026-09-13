import { describe, expect, it } from "vitest";
import { formatDayHours, parseHours, resolveOpenState } from "@/lib/org-hours";
import {
  directionsHref,
  emailHref,
  isDialable,
  scoreListing,
  telHref,
  websiteHref,
} from "@/lib/org-listing";
import { normalizeProfileUrl, validateProfileUrl } from "@/components/profile/ProfileLinksFields";

describe("listing action links", () => {
  it("normalizes scheme-less websites", () => {
    expect(websiteHref("google.com")).toBe("https://google.com/");
    expect(websiteHref("http://google.com")).toBe("http://google.com/");
    expect(websiteHref("  example.com  ")).toBe("https://example.com/");
    expect(websiteHref("sub.example.com/gym")).toBe("https://sub.example.com/gym");
    expect(websiteHref("www.example.co.uk/a?b=1")).toBe("https://www.example.co.uk/a?b=1");
  });

  it("accepts bare domains in profile links and rejects bad ones", () => {
    expect(normalizeProfileUrl("yoursite.com")).toBe("https://yoursite.com");
    expect(normalizeProfileUrl("instagram.com/handle")).toBe("https://instagram.com/handle");
    expect(validateProfileUrl("yoursite.com")).toBe(null);
    expect(validateProfileUrl("sub.example.co.uk/x")).toBe(null);
    expect(validateProfileUrl("javascript:alert(1)")).not.toBe(null);
    expect(validateProfileUrl("notadomain")).not.toBe(null);
  });

  it("rejects unsafe or unusable websites", () => {
    expect(websiteHref("javascript:alert(1)")).toBe(null);
    expect(websiteHref("//evil.com")).toBe(null);
    expect(websiteHref("   ")).toBe(null);
    expect(websiteHref("notadomain")).toBe(null);
  });

  it("builds tel links with extensions", () => {
    expect(telHref("+1 (678) 341-0221 x12")).toBe("tel:+16783410221;ext=12");
    expect(telHref("678-341-0221")).toBe("tel:6783410221");
    expect(telHref("123")).toBe(null);
    expect(isDialable("6783410221")).toBe(true);
    expect(isDialable("")).toBe(false);
  });

  it("validates emails", () => {
    expect(emailHref("hi@peak.com")).toBe("mailto:hi@peak.com");
    expect(emailHref(" ")).toBe(null);
    expect(emailHref("nope")).toBe(null);
    expect(emailHref("a b@peak.com")).toBe(null);
  });

  it("builds directions from address, coords, or place id", () => {
    expect(directionsHref({ address: "123 city" })).toContain("destination=123+city");
    expect(directionsHref({ lat: 30.1, lng: -97.5 })).toContain("destination=30.1%2C-97.5");
    expect(directionsHref({ address: "x y", placeId: "abc" })).toContain(
      "destination_place_id=abc",
    );
    expect(directionsHref({ address: "  ", lat: null, lng: null })).toBe(null);
    expect(directionsHref({})).toBe(null);
  });
});

const tz = "UTC";
const at = (iso: string) => new Date(iso);

describe("org hours", () => {
  it("drops malformed ranges when parsing", () => {
    const h = parseHours({
      "1": {
        ranges: [
          { open: "9:00", close: "21:00" },
          { open: "09:00", close: "21:00" },
        ],
      },
    });
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
