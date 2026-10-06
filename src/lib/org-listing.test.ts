import { describe, expect, it } from "vitest";
import { describeOpenBadge, formatDayHours, parseHours, resolveOpenState } from "@/lib/org-hours";
import {
  ORG_AMENITIES,
  bookingHref,
  highlightAmenities,
  suggestHandle,
  courtCountFromAmenities,
  withCourtCount,
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

describe("court count amenity", () => {
  it("reads and writes the count as a readable amenity entry", () => {
    expect(courtCountFromAmenities(["Parking", "4 courts"])).toBe(4);
    expect(courtCountFromAmenities(["1 court"])).toBe(1);
    expect(courtCountFromAmenities(["Parking"])).toBe(null);
    expect(withCourtCount(["Parking"], 3)).toEqual(["3 courts", "Parking"]);
    expect(withCourtCount(["2 courts", "Parking"], 1)).toEqual(["1 court", "Parking"]);
    expect(withCourtCount(["2 courts", "Parking"], 0)).toEqual(["Parking"]);
    expect(withCourtCount(["Parking"], 500)).toEqual(["99 courts", "Parking"]);
  });

  it("does not count the court total toward the 3-amenity checklist item", () => {
    const base = {
      name: "Peak",
      handle: "peak",
      category: "Gym",
      address: "123 Main St",
      phone: "",
      email: "",
      website: "",
      bio: "",
      hours: {},
      photos: [],
      avatarUrl: "",
      coverUrl: "",
    };
    const done = (amenities: string[]) =>
      scoreListing({ ...base, amenities }).items.find((i) => i.id === "amenities")!.done;
    expect(done(["4 courts", "Lighting", "Parking"])).toBe(false);
    expect(done(["4 courts", "Lighting", "Parking", "Showers"])).toBe(true);
  });

  it("offers the expanded court and equipment amenities", () => {
    for (const a of [
      "Hardwood courts",
      "Outdoor cages",
      "Lighting",
      "Ball rentals",
      "Scoreboards",
    ]) {
      expect(ORG_AMENITIES).toContain(a);
    }
    expect(new Set(ORG_AMENITIES).size).toBe(ORG_AMENITIES.length);
  });
});

describe("suggestHandle", () => {
  it("slugifies facility names into valid handles", () => {
    expect(suggestHandle("Peak Gym & Courts")).toBe("peak-gym-courts");
    expect(suggestHandle("  Café Hoops!! ")).toBe("cafe-hoops");
    expect(suggestHandle("A".repeat(60))).toHaveLength(40);
    expect(suggestHandle("???")).toBe("");
  });
});

describe("highlightAmenities", () => {
  it("leads with the court count, then priority features", () => {
    const r = highlightAmenities(["Wi-Fi", "Parking", "4 courts", "Lighting", "Indoor courts"]);
    expect(r.tags).toEqual(["4 courts", "Indoor courts", "Lighting", "Parking", "Wi-Fi"]);
    expect(r.more).toBe(0);
  });

  it("caps the tags and reports how many were left off", () => {
    const r = highlightAmenities(
      ["Indoor courts", "Outdoor courts", "Turf field", "Lighting", "Parking", "Lockers", "Wi-Fi"],
      4,
    );
    expect(r.tags).toEqual(["Indoor courts", "Outdoor courts", "Turf field", "Lighting"]);
    expect(r.more).toBe(3);
  });

  it("handles missing amenities", () => {
    expect(highlightAmenities(null)).toEqual({ tags: [], more: 0 });
  });
});

describe("describeOpenBadge", () => {
  // 2026-10-06 is a Tuesday. Hours Mon–Sun 06:00–22:00 in UTC.
  const hours = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), { ranges: [{ open: "06:00", close: "22:00" }] }]),
  );

  it("shows open now with the closing time", () => {
    const b = describeOpenBadge(hours, "UTC", new Date("2026-10-06T15:00:00Z"));
    expect(b).toEqual({ tone: "open", headline: "Open now", detail: "Closes at 10 PM" });
  });

  it("flags closing soon within the last hour", () => {
    const b = describeOpenBadge(hours, "UTC", new Date("2026-10-06T21:15:00Z"));
    expect(b.tone).toBe("closing");
    expect(b.headline).toBe("Closing soon");
    expect(b.detail).toBe("Closes at 10 PM");
  });

  it("shows when a closed facility opens next, in its own timezone", () => {
    const late = describeOpenBadge(hours, "UTC", new Date("2026-10-06T23:30:00Z"));
    expect(late).toEqual({ tone: "closed", headline: "Closed", detail: "Opens tomorrow 6 AM" });
    // 23:30 UTC is 19:30 in New York → still open there.
    expect(
      describeOpenBadge(hours, "America/New_York", new Date("2026-10-06T23:30:00Z")).tone,
    ).toBe("open");
  });

  it("handles 24h and unset hours", () => {
    const all = { "2": { open24: true } };
    expect(describeOpenBadge(all, "UTC", new Date("2026-10-06T03:00:00Z")).detail).toBe(
      "Open 24 hours",
    );
    expect(describeOpenBadge({}, "UTC")).toEqual({
      tone: "unknown",
      headline: "Hours not set",
      detail: null,
    });
  });
});

describe("bookingHref", () => {
  it("prefers the dedicated booking link over the website", () => {
    expect(bookingHref({ booking_url: "courtreserve.com/peak", website: "peak.com" })).toBe(
      "https://courtreserve.com/peak",
    );
  });

  it("falls back to the website, then to nothing (in-app inquiry)", () => {
    expect(bookingHref({ booking_url: null, website: "peak.com" })).toBe("https://peak.com/");
    expect(bookingHref({ booking_url: "  ", website: "peak.com" })).toBe("https://peak.com/");
    expect(bookingHref({ booking_url: null, website: null })).toBeNull();
    expect(bookingHref({})).toBeNull();
  });

  it("never links an unsafe booking URL, and then uses the website", () => {
    expect(bookingHref({ booking_url: "javascript:alert(1)", website: "peak.com" })).toBe(
      "https://peak.com/",
    );
    expect(bookingHref({ booking_url: "javascript:alert(1)" })).toBeNull();
  });
});
