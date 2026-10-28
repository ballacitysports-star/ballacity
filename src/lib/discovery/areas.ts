/**
 * Where discovery looks and what it looks for.
 *
 * Discovery finds *leads* (a web address that may belong to a team, gym or
 * trainer) from two places: web search, and OpenStreetMap. Every fact about a
 * lead is then read from the organization's own website and checked by a
 * person before anything is listed. OpenStreetMap is used for leads only (its
 * licence restricts copying its data into another database), so nothing but a
 * website address is taken from it.
 */

export const DISCOVERY_TYPES = ["gym", "team", "coach"] as const;
export type DiscoveryType = (typeof DISCOVERY_TYPES)[number];

export const DISCOVERY_TYPE_LABELS: Record<DiscoveryType, string> = {
  gym: "Gyms & facilities",
  team: "Teams & clubs",
  coach: "Trainers",
};

export type DiscoveryArea = {
  id: string;
  label: string;
  city: string;
  state: string;
  /** south, west, north, east */
  bbox: readonly [number, number, number, number];
  /** Added to every search so results stay local. */
  searchSuffix: string;
};

export const DISCOVERY_AREAS: readonly DiscoveryArea[] = [
  {
    id: "atlanta",
    label: "Atlanta, GA",
    city: "Atlanta",
    state: "GA",
    // The city and its close-in suburbs (Decatur, Sandy Springs, Marietta, College Park).
    bbox: [33.6, -84.65, 34.0, -84.15],
    searchSuffix: "Atlanta GA",
  },
];

export function areaById(id: string): DiscoveryArea | null {
  return DISCOVERY_AREAS.find((a) => a.id === id) ?? null;
}

const TOPICS: Record<DiscoveryType, readonly string[]> = {
  gym: [
    "basketball gym",
    "indoor sports facility",
    "recreation center",
    "indoor basketball court rental",
    "sports complex",
    "indoor soccer facility",
    "volleyball training facility",
    "pickleball courts",
    "batting cages baseball training facility",
  ],
  team: [
    "AAU basketball club",
    "youth basketball program",
    "adult recreational sports league",
    "travel soccer club",
    "youth football league",
    "volleyball club",
    "travel baseball team",
    "flag football league",
    "adult pickup basketball league",
  ],
  coach: [
    "basketball skills trainer",
    "private sports training",
    "speed and agility training",
    "tennis coach",
    "soccer trainer",
    "baseball hitting lessons",
    "football position training",
    "pickleball coach",
  ],
};

export type SearchTask = { kind: "search"; type: DiscoveryType; q: string };
export type OsmTask = { kind: "osm"; type: DiscoveryType };
export type DiscoveryTask = SearchTask | OsmTask;

/** OpenStreetMap tag filters per type; trainers are not mapped there. */
const OSM_FILTERS: Partial<Record<DiscoveryType, readonly string[]>> = {
  gym: [
    '["leisure"~"^(sports_centre|fitness_centre|sports_hall)$"]',
    '["amenity"="community_centre"]["sport"]',
  ],
  team: ['["club"="sport"]'],
};

export function searchTasks(area: DiscoveryArea, types: readonly DiscoveryType[]): SearchTask[] {
  return types.flatMap((type) =>
    TOPICS[type].map((topic) => ({
      kind: "search" as const,
      type,
      q: `${topic} ${area.searchSuffix}`,
    })),
  );
}

export function osmTasks(types: readonly DiscoveryType[]): OsmTask[] {
  return types.filter((t) => OSM_FILTERS[t]).map((type) => ({ kind: "osm" as const, type }));
}

/** The Overpass query for one type: mapped places in the area that list a website. */
export function overpassQuery(area: DiscoveryArea, type: DiscoveryType): string {
  const filters = OSM_FILTERS[type] ?? [];
  const [s, w, n, e] = area.bbox;
  const box = `(${s},${w},${n},${e})`;
  const lines = filters.flatMap((f) => [
    `  nwr${f}["website"]${box};`,
    `  nwr${f}["contact:website"]${box};`,
  ]);
  return `[out:json][timeout:20];\n(\n${lines.join("\n")}\n);\nout tags center 300;`;
}

export type OsmLead = {
  /** "node/123", "way/456" */
  ref: string;
  website: string;
  /** Only a hint for the reader of the website; never stored. */
  hintName: string | null;
  hintSport: string | null;
};

/** Leads from an Overpass response. Anything without a website is dropped. */
export function parseOverpass(json: unknown): OsmLead[] {
  const elements = (json as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const out: OsmLead[] = [];
  for (const el of elements) {
    const e = el as { type?: unknown; id?: unknown; tags?: Record<string, unknown> };
    const tags = e?.tags ?? {};
    const website = String(tags["website"] ?? tags["contact:website"] ?? "").trim();
    if (!website || typeof e.type !== "string" || typeof e.id !== "number") continue;
    out.push({
      ref: `${e.type}/${e.id}`,
      website,
      hintName: tags["name"] ? String(tags["name"]).slice(0, 120) : null,
      hintSport: tags["sport"] ? String(tags["sport"]).slice(0, 60) : null,
    });
  }
  return out;
}
