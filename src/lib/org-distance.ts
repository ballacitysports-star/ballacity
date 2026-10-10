// Viewer-relative distance for teams and trainers.
//
// Mirrors `game-distance.ts`: great-circle distance from the viewer's location
// to the org's real coordinates, or `null` when we can't measure it so the UI
// hides the chip instead of showing an invented number.
import type { Org } from "@/lib/sample-data";
import { haversineKm, MI_PER_KM, type LatLng } from "@/lib/geo";
import { cityForText } from "@/lib/launch-cities";

export type OrgDistance = {
  mi: number;
  /** True when measured to the city centre rather than a verified venue. */
  approx: boolean;
};

function validPoint(p: { lat?: number | null; lng?: number | null }): p is LatLng {
  const { lat, lng } = p;
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Distance from the viewer to the org's nearest verified venue. Orgs without
 * venue coordinates (most teams) fall back to the centre of their city when it
 * is a known one, flagged `approx`.
 */
export function orgDistance(
  org: Pick<Org, "venueGeo" | "city">,
  viewer: LatLng | null,
): OrgDistance | null {
  if (!viewer) return null;
  let minKm: number | null = null;
  for (const g of org.venueGeo ?? []) {
    if (!validPoint(g)) continue;
    const km = haversineKm(viewer, g);
    if (minKm == null || km < minKm) minKm = km;
  }
  if (minKm != null) return { mi: minKm * MI_PER_KM, approx: false };

  const city = cityForText(org.city);
  if (city) return { mi: haversineKm(viewer, city) * MI_PER_KM, approx: true };
  return null;
}

/** Miles for sorting: unmeasurable orgs sort last. */
export function orgDistanceMi(
  org: Pick<Org, "venueGeo" | "city">,
  viewer: LatLng | null,
): number | null {
  return orgDistance(org, viewer)?.mi ?? null;
}
