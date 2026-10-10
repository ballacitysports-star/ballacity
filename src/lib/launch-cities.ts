/**
 * Launch cities for the city landing pages (/cities/$city).
 *
 * Each is a US metro with at least one top-tier professional team (NFL, NBA,
 * WNBA, MLB, NHL, MLS or NWSL). That is the only inclusion rule: the sport
 * doesn't matter, and no team names are listed here so the data can't go
 * stale when a franchise moves.
 *
 * `lat`/`lng` are the city centre. Games carry coordinates but no city, so a
 * game belongs to the city whose centre it sits within `radiusKm` of.
 */
export type LaunchCity = {
  /** URL slug, e.g. "austin-tx". */
  slug: string;
  name: string;
  /** Two-letter state code. */
  state: string;
  lat: number;
  lng: number;
  /** How far from the centre still counts as "in" the metro. */
  radiusKm: number;
};

const c = (name: string, state: string, lat: number, lng: number, radiusKm = 35): LaunchCity => ({
  slug: `${name}-${state}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, ""),
  name,
  state,
  lat,
  lng,
  radiusKm,
});

export const LAUNCH_CITIES: readonly LaunchCity[] = [
  c("New York", "NY", 40.7128, -74.006, 40),
  c("Los Angeles", "CA", 34.0522, -118.2437, 45),
  c("Chicago", "IL", 41.8781, -87.6298, 40),
  c("Houston", "TX", 29.7604, -95.3698, 40),
  c("Dallas", "TX", 32.7767, -96.797, 40),
  c("Philadelphia", "PA", 39.9526, -75.1652),
  c("Phoenix", "AZ", 33.4484, -112.074, 40),
  c("San Antonio", "TX", 29.4241, -98.4936),
  c("San Diego", "CA", 32.7157, -117.1611),
  c("San Francisco", "CA", 37.7749, -122.4194, 25),
  c("San Jose", "CA", 37.3382, -121.8863, 25),
  c("Austin", "TX", 30.2672, -97.7431),
  c("Jacksonville", "FL", 30.3322, -81.6557),
  c("Columbus", "OH", 39.9612, -82.9988),
  c("Charlotte", "NC", 35.2271, -80.8431),
  c("Indianapolis", "IN", 39.7684, -86.1581),
  c("Seattle", "WA", 47.6062, -122.3321),
  c("Denver", "CO", 39.7392, -104.9903),
  c("Washington", "DC", 38.9072, -77.0369),
  c("Boston", "MA", 42.3601, -71.0589),
  c("Nashville", "TN", 36.1627, -86.7816),
  c("Detroit", "MI", 42.3314, -83.0458),
  c("Oklahoma City", "OK", 35.4676, -97.5164),
  c("Portland", "OR", 45.5152, -122.6784),
  c("Las Vegas", "NV", 36.1699, -115.1398),
  c("Memphis", "TN", 35.1495, -90.049),
  c("Louisville", "KY", 38.2527, -85.7585),
  c("Baltimore", "MD", 39.2904, -76.6122),
  c("Milwaukee", "WI", 43.0389, -87.9065),
  c("Kansas City", "MO", 39.0997, -94.5786),
  c("Atlanta", "GA", 33.749, -84.388),
  c("Miami", "FL", 25.7617, -80.1918),
  c("Orlando", "FL", 28.5383, -81.3792),
  c("Tampa", "FL", 27.9506, -82.4572),
  c("Minneapolis", "MN", 44.9778, -93.265),
  c("St. Louis", "MO", 38.627, -90.1994),
  c("Pittsburgh", "PA", 40.4406, -79.9959),
  c("Cincinnati", "OH", 39.1031, -84.512),
  c("Cleveland", "OH", 41.4993, -81.6944),
  c("New Orleans", "LA", 29.9511, -90.0715),
  c("Salt Lake City", "UT", 40.7608, -111.891),
  c("Sacramento", "CA", 38.5816, -121.4944),
  c("Buffalo", "NY", 42.8864, -78.8784),
  c("Raleigh", "NC", 35.7796, -78.6382),
  c("Green Bay", "WI", 44.5133, -88.0133, 25),
];

const BY_SLUG = new Map(LAUNCH_CITIES.map((city) => [city.slug, city]));

export function cityBySlug(slug: string): LaunchCity | undefined {
  return BY_SLUG.get(slug.toLowerCase());
}

export function cityLabel(city: LaunchCity): string {
  return `${city.name}, ${city.state}`;
}

/** Great-circle distance in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Lat/lng box around a city, for a cheap database pre-filter. */
export function cityBounds(city: LaunchCity) {
  const dLat = city.radiusKm / 111;
  const dLng = city.radiusKm / (111 * Math.max(0.2, Math.cos((city.lat * Math.PI) / 180)));
  return {
    minLat: city.lat - dLat,
    maxLat: city.lat + dLat,
    minLng: city.lng - dLng,
    maxLng: city.lng + dLng,
  };
}

/**
 * The launch city a point belongs to: the nearest city whose radius contains
 * it, so overlapping metros (San Francisco / San Jose) never double count.
 */
export function cityForPoint(lat: number, lng: number): LaunchCity | undefined {
  let best: LaunchCity | undefined;
  let bestKm = Infinity;
  for (const city of LAUNCH_CITIES) {
    const km = distanceKm(city.lat, city.lng, lat, lng);
    if (km <= city.radiusKm && km < bestKm) {
      best = city;
      bestKm = km;
    }
  }
  return best;
}

/**
 * The launch city a free-text city field ("Austin", "Austin, TX",
 * "austin tx") refers to. A state suffix, when present, must agree.
 */
export function cityForText(text: string | null | undefined): LaunchCity | undefined {
  const raw = (text ?? "").trim().toLowerCase();
  if (!raw) return undefined;
  const [place, rest] = raw.split(",").map((s) => s.trim());
  const state = (rest ?? "").slice(0, 2).toUpperCase();
  return LAUNCH_CITIES.find(
    (city) => city.name.toLowerCase() === place && (!state || city.state === state),
  );
}
