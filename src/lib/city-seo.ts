import { SITE_URL } from "@/lib/seo";
import { cityForPoint, cityForText, cityLabel, type LaunchCity } from "@/lib/launch-cities";
import { SPORT_GUIDES } from "@/lib/sports-guide";

/**
 * SEO rules for the city landing pages and the public-entity sitemap entries.
 *
 * Two safety rules are applied everywhere a listing could reach a search
 * engine, because a crawler is an anonymous audience:
 *  - private, hidden, cancelled and past games are never exposed, and
 *  - anything aimed at under-18s (youth games, youth/teen trainers) is kept
 *    out of search indexes and out of the city pages entirely.
 */

/** A city or city×sport page with fewer listings than this is thin: noindex. */
export const MIN_LISTINGS_TO_INDEX = 3;

export type CityGameRow = {
  id: string;
  title: string;
  sport: string;
  date: string;
  location: string;
  neighborhood: string;
  price: number;
  skill: string;
  lat: number | null;
  lng: number | null;
  min_age: number | null;
  max_age: number | null;
  is_private: boolean;
  hidden_at: string | null;
  org_hidden_at: string | null;
  cancelled_at: string | null;
  updated_at?: string | null;
};

export type CityOrgRow = {
  id: string;
  name: string;
  city: string | null;
  sports: string[] | null;
  kind: string | null;
  tagline: string | null;
  age_groups: string[] | null;
  hidden_at: string | null;
  updated_at?: string | null;
};

export type CityGymRow = {
  id: string;
  name: string;
  city: string | null;
  category: string | null;
  hidden_at: string | null;
  updated_at?: string | null;
};

/** True when the game could be open to someone under 18. */
export function gameTouchesMinors(g: Pick<CityGameRow, "min_age" | "max_age">): boolean {
  return g.max_age !== null && g.max_age < 18;
}

/** True only when the host set a minimum age of 18+, so no minor can join. */
export function isAdultsOnlyGame(g: Pick<CityGameRow, "min_age">): boolean {
  return g.min_age !== null && g.min_age >= 18;
}

/** Whether a game may be shown to anonymous visitors and crawlers. */
export function isPublicUpcomingGame(g: CityGameRow, now: Date = new Date()): boolean {
  if (g.is_private || g.hidden_at || g.org_hidden_at || g.cancelled_at) return false;
  if (gameTouchesMinors(g)) return false;
  const t = Date.parse(g.date);
  return Number.isFinite(t) && t >= now.getTime();
}

/** Teams and trainers that say they work with kids/teens stay off public pages. */
export function orgTouchesMinors(o: Pick<CityOrgRow, "age_groups">): boolean {
  return (o.age_groups ?? []).some((a) => a === "youth" || a === "teen");
}

/** True only when the team lists age groups and none of them is youth or teen. */
export function isAdultsOnlyOrg(o: Pick<CityOrgRow, "age_groups">): boolean {
  return (o.age_groups ?? []).length > 0 && !orgTouchesMinors(o);
}

export function isPublicOrg(o: CityOrgRow): boolean {
  return !o.hidden_at && !orgTouchesMinors(o);
}

export function guideSlugForSport(sport: string): string | undefined {
  return SPORT_GUIDES.find((g) => g.sport.toLowerCase() === sport.toLowerCase())?.slug;
}

export function sportForGuideSlug(slug: string): string | undefined {
  return SPORT_GUIDES.find((g) => g.slug === slug.toLowerCase())?.sport;
}

export type CityListings = {
  games: CityGameRow[];
  teams: CityOrgRow[];
  trainers: CityOrgRow[];
  gyms: CityGymRow[];
};

export const emptyListings = (): CityListings => ({
  games: [],
  teams: [],
  trainers: [],
  gyms: [],
});

export const listingCount = (l: CityListings) =>
  l.games.length + l.teams.length + l.trainers.length + l.gyms.length;

export function filterBySport(l: CityListings, sport: string): CityListings {
  const s = sport.toLowerCase();
  const hasSport = (o: CityOrgRow) => (o.sports ?? []).some((x) => x.toLowerCase() === s);
  return {
    games: l.games.filter((g) => g.sport.toLowerCase() === s),
    teams: l.teams.filter(hasSport),
    trainers: l.trainers.filter(hasSport),
    // A gym row doesn't carry sports; it only counts toward the city hub.
    gyms: [],
  };
}

/**
 * Sorts raw rows into per-city listings, applying the public/minor rules.
 * Games are placed by coordinates, teams/trainers/gyms by their city text.
 */
export function bucketByCity(
  rows: {
    games: readonly CityGameRow[];
    orgs: readonly CityOrgRow[];
    gyms: readonly CityGymRow[];
  },
  now: Date = new Date(),
): Map<string, CityListings> {
  const out = new Map<string, CityListings>();
  const at = (city: LaunchCity) => {
    let l = out.get(city.slug);
    if (!l) out.set(city.slug, (l = emptyListings()));
    return l;
  };
  for (const g of rows.games) {
    if (g.lat === null || g.lng === null || !isPublicUpcomingGame(g, now)) continue;
    const city = cityForPoint(g.lat, g.lng);
    if (city) at(city).games.push(g);
  }
  for (const o of rows.orgs) {
    if (!isPublicOrg(o)) continue;
    const city = cityForText(o.city);
    if (!city) continue;
    (o.kind === "coach" ? at(city).trainers : at(city).teams).push(o);
  }
  for (const gym of rows.gyms) {
    if (gym.hidden_at) continue;
    const city = cityForText(gym.city);
    if (city) at(city).gyms.push(gym);
  }
  return out;
}

type SitemapRow = {
  path: string;
  changefreq: "daily" | "weekly";
  priority: string;
  lastmod?: string;
};

const day = (iso?: string | null) =>
  iso && !Number.isNaN(Date.parse(iso)) ? iso.slice(0, 10) : undefined;

/**
 * Sitemap rows for the launch-city pages. Only pages with enough real
 * listings are included, matching the noindex rule on the pages themselves.
 */
export function citySitemapEntries(
  cities: readonly LaunchCity[],
  byCity: ReadonlyMap<string, CityListings>,
): SitemapRow[] {
  const out: SitemapRow[] = [];
  for (const city of cities) {
    const listings = byCity.get(city.slug);
    if (!listings || listingCount(listings) < MIN_LISTINGS_TO_INDEX) continue;
    out.push({ path: `/cities/${city.slug}`, changefreq: "daily", priority: "0.8" });
    const sports = new Set<string>([
      ...listings.games.map((g) => g.sport),
      ...listings.teams.flatMap((t) => t.sports ?? []),
      ...listings.trainers.flatMap((t) => t.sports ?? []),
    ]);
    for (const sport of sports) {
      const slug = guideSlugForSport(sport);
      if (!slug) continue;
      if (listingCount(filterBySport(listings, sport)) < MIN_LISTINGS_TO_INDEX) continue;
      out.push({
        path: `/cities/${city.slug}/${slug}`,
        changefreq: "daily",
        priority: "0.7",
      });
    }
  }
  return out;
}

/** Sitemap rows for individual public games, teams and trainers. */
export function entitySitemapEntries(
  rows: {
    games: readonly CityGameRow[];
    orgs: readonly CityOrgRow[];
  },
  now: Date = new Date(),
): SitemapRow[] {
  const games = rows.games
    .filter((g) => isPublicUpcomingGame(g, now))
    .map((g): SitemapRow => ({
      path: `/games/${g.id}`,
      changefreq: "daily",
      priority: "0.5",
      lastmod: day(g.updated_at),
    }));
  const orgs = rows.orgs.filter(isPublicOrg).map((o): SitemapRow => ({
    path: o.kind === "coach" ? `/trainers/${o.id}` : `/teams/${o.id}`,
    changefreq: "weekly",
    priority: "0.5",
    lastmod: day(o.updated_at),
  }));
  return [...games, ...orgs];
}

export function cityTitle(city: LaunchCity, sport?: string): string {
  return sport
    ? `Pickup ${sport} in ${cityLabel(city)} — games, teams & trainers | BallaCity`
    : `Pickup Games in ${cityLabel(city)} — ${cityLabel(city)} Sports Network | BallaCity`;
}

export function cityDescription(city: LaunchCity, listings: CityListings, sport?: string): string {
  const parts = [
    listings.games.length ? `${listings.games.length} upcoming games` : null,
    listings.teams.length ? `${listings.teams.length} teams` : null,
    listings.trainers.length ? `${listings.trainers.length} trainers` : null,
    listings.gyms.length ? `${listings.gyms.length} gyms` : null,
  ].filter(Boolean);
  const what = sport ? `pickup ${sport.toLowerCase()}` : "pickup games";
  const found = parts.length ? ` ${parts.join(", ")} on BallaCity.` : "";
  return `Find ${what} in ${cityLabel(city)}.${found} See times, skill levels and spots, then request to join.`.slice(
    0,
    160,
  );
}

/** ItemList + SportsEvent structured data for a city page. */
export function buildCityJsonLd(city: LaunchCity, listings: CityListings, path: string) {
  const items = [
    ...listings.games.slice(0, 20).map((g) => ({
      "@type": "SportsEvent",
      name: g.title,
      sport: g.sport,
      startDate: g.date,
      eventStatus: "https://schema.org/EventScheduled",
      location: {
        "@type": "Place",
        name: g.location,
        address: [g.neighborhood, cityLabel(city)].filter(Boolean).join(", "),
      },
      url: `${SITE_URL}/games/${g.id}`,
    })),
    ...listings.teams.slice(0, 10).map((t) => ({
      "@type": "SportsTeam",
      name: t.name,
      url: `${SITE_URL}/teams/${t.id}`,
    })),
  ];
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `Pickup games in ${cityLabel(city)}`,
    url: `${SITE_URL}${path}`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, item })),
    },
  };
}
