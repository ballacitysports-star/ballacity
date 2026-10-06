import { WEEKDAYS, parseHours, type OrgHours } from "@/lib/org-hours";
import { bookingHref } from "@/lib/org-listing";
import { SITE_URL } from "@/lib/seo";

/**
 * Structured data and sitemap entries for facility pages. Only public fields
 * go in: a facility's phone and email are hidden from anonymous visitors, so
 * they never appear here, and nothing is invented (no rating unless real
 * reviews are passed in).
 */

export type FacilitySeoInput = {
  id: string;
  name: string;
  bio?: string | null;
  address?: string | null;
  city?: string | null;
  geo?: unknown;
  hours?: unknown;
  amenities?: string[] | null;
  photos?: string[] | null;
  cover_url?: string | null;
  avatar_url?: string | null;
  website?: string | null;
  booking_url?: string | null;
  category?: string | null;
};

const isHttps = (u: unknown): u is string => typeof u === "string" && /^https?:\/\//i.test(u);

/** schema.org OpeningHoursSpecification entries, skipping closed days. */
export function openingHoursSpecification(hours: OrgHours) {
  const out: Array<{
    "@type": "OpeningHoursSpecification";
    dayOfWeek: string;
    opens: string;
    closes: string;
  }> = [];
  for (let d = 0; d < 7; d++) {
    const day = hours[String(d)];
    if (!day || day.closed) continue;
    const dayOfWeek = WEEKDAYS[d];
    if (day.open24) {
      out.push({
        "@type": "OpeningHoursSpecification",
        dayOfWeek,
        opens: "00:00",
        closes: "23:59",
      });
      continue;
    }
    for (const r of day.ranges ?? []) {
      out.push({ "@type": "OpeningHoursSpecification", dayOfWeek, opens: r.open, closes: r.close });
    }
  }
  return out;
}

export function buildFacilityJsonLd(
  org: FacilitySeoInput,
  rating?: { avg: number; count: number },
) {
  const url = `${SITE_URL}/orgs/${org.id}`;
  const images = [org.cover_url, ...(org.photos ?? []), org.avatar_url].filter(isHttps).slice(0, 6);
  const geo = (org.geo ?? null) as { lat?: unknown; lng?: unknown } | null;
  const hasGeo = typeof geo?.lat === "number" && typeof geo?.lng === "number";
  const hours = openingHoursSpecification(parseHours(org.hours));
  const amenities = (org.amenities ?? []).filter(Boolean);
  const sameAs = [bookingHref(org)].filter(isHttps);

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "SportsActivityLocation",
    name: org.name,
    url,
  };
  if (org.bio?.trim()) ld.description = org.bio.trim().slice(0, 300);
  if (images.length) ld.image = images;
  const address = org.address ?? org.city;
  if (address) ld.address = address;
  if (hasGeo) ld.geo = { "@type": "GeoCoordinates", latitude: geo!.lat, longitude: geo!.lng };
  if (hours.length) ld.openingHoursSpecification = hours;
  if (amenities.length) {
    ld.amenityFeature = amenities.map((name) => ({
      "@type": "LocationFeatureSpecification",
      name,
      value: true,
    }));
  }
  if (sameAs.length) ld.sameAs = sameAs;
  if (rating && rating.count > 0) {
    ld.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: Math.round(rating.avg * 10) / 10,
      reviewCount: rating.count,
    };
  }
  return ld;
}

export type SitemapFacilityRow = { id: string; updated_at?: string | null };

/** Sitemap entries for public facility pages. */
export function facilitySitemapEntries(rows: readonly SitemapFacilityRow[]) {
  return rows.map((r) => ({
    path: `/orgs/${r.id}`,
    changefreq: "weekly" as const,
    priority: "0.6",
    lastmod:
      r.updated_at && !Number.isNaN(Date.parse(r.updated_at))
        ? r.updated_at.slice(0, 10)
        : undefined,
  }));
}
