import { describe, expect, it } from "vitest";
import {
  buildFacilityJsonLd,
  facilitySitemapEntries,
  openingHoursSpecification,
} from "@/lib/org-seo";

const week = {
  "1": { ranges: [{ open: "06:00", close: "22:00" }] },
  "2": {
    ranges: [
      { open: "06:00", close: "12:00" },
      { open: "14:00", close: "22:00" },
    ],
  },
  "3": { closed: true },
  "6": { open24: true },
};

type Ld = {
  "@type": string;
  name: string;
  url: string;
  address?: string;
  geo?: unknown;
  image?: string[];
  sameAs?: string[];
  aggregateRating?: unknown;
  openingHoursSpecification: unknown[];
  amenityFeature: { name: string }[];
};

const org = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Apex Basketball Hub",
  bio: "Four hardwood courts.",
  address: "123 Main St, Austin, TX",
  city: "Austin",
  geo: { lat: 30.27, lng: -97.74 },
  hours: week,
  amenities: ["4 courts", "Lighting", "Parking"],
  photos: ["https://img.test/a.jpg", "not-a-url"],
  cover_url: "https://img.test/cover.jpg",
  avatar_url: null,
  website: "apex.com",
  booking_url: "courtreserve.com/apex",
};

describe("openingHoursSpecification", () => {
  it("lists each open range per weekday and skips closed days", () => {
    const spec = openingHoursSpecification(week as never);
    expect(spec.map((s) => [s.dayOfWeek, s.opens, s.closes])).toEqual([
      ["Monday", "06:00", "22:00"],
      ["Tuesday", "06:00", "12:00"],
      ["Tuesday", "14:00", "22:00"],
      ["Saturday", "00:00", "23:59"],
    ]);
  });
});

describe("buildFacilityJsonLd", () => {
  const ld = buildFacilityJsonLd(org) as Ld;

  it("describes the facility with public details", () => {
    expect(ld["@type"]).toBe("SportsActivityLocation");
    expect(ld.name).toBe("Apex Basketball Hub");
    expect(ld.url).toBe("https://ballacity.com/orgs/11111111-1111-1111-1111-111111111111");
    expect(ld.address).toBe("123 Main St, Austin, TX");
    expect(ld.geo).toEqual({ "@type": "GeoCoordinates", latitude: 30.27, longitude: -97.74 });
    expect(ld.openingHoursSpecification).toHaveLength(4);
    expect(ld.amenityFeature.map((a) => a.name)).toEqual(["4 courts", "Lighting", "Parking"]);
  });

  it("only includes absolute image URLs and prefers the booking link for sameAs", () => {
    expect(ld.image).toEqual(["https://img.test/cover.jpg", "https://img.test/a.jpg"]);
    expect(ld.sameAs).toEqual(["https://courtreserve.com/apex"]);
  });

  it("never exposes phone or email, and invents no rating", () => {
    const withContact = buildFacilityJsonLd({
      ...org,
      phone: "555-1234",
      email: "a@b.co",
    } as never);
    const text = JSON.stringify(withContact);
    expect(text).not.toContain("555-1234");
    expect(text).not.toContain("a@b.co");
    expect(ld.aggregateRating).toBeUndefined();
  });

  it("adds a rating only when real review counts are supplied", () => {
    const rated = buildFacilityJsonLd(org, { avg: 4.66, count: 12 }) as Ld;
    expect(rated.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.7,
      reviewCount: 12,
    });
    expect((buildFacilityJsonLd(org, { avg: 5, count: 0 }) as Ld).aggregateRating).toBeUndefined();
  });

  it("omits what a bare listing doesn't have", () => {
    const bare = buildFacilityJsonLd({ id: "x", name: "Bare Gym" }) as Record<string, unknown>;
    expect(Object.keys(bare).sort()).toEqual(["@context", "@type", "name", "url"]);
    const badGeo = buildFacilityJsonLd({ id: "x", name: "G", geo: "oops" }) as Record<
      string,
      unknown
    >;
    expect(badGeo.geo).toBeUndefined();
  });
});

describe("facilitySitemapEntries", () => {
  it("builds a path and last-modified date per facility", () => {
    expect(
      facilitySitemapEntries([
        { id: "a", updated_at: "2026-10-05T12:30:00.000Z" },
        { id: "b", updated_at: null },
        { id: "c", updated_at: "garbage" },
      ]),
    ).toEqual([
      { path: "/orgs/a", changefreq: "weekly", priority: "0.6", lastmod: "2026-10-05" },
      { path: "/orgs/b", changefreq: "weekly", priority: "0.6", lastmod: undefined },
      { path: "/orgs/c", changefreq: "weekly", priority: "0.6", lastmod: undefined },
    ]);
  });
});
