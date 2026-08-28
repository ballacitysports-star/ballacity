// Viewer-relative distance for games.
//
// The DB no longer stores a meaningful `distance_mi` — distance depends on who
// is looking. These helpers compute the great-circle distance between the
// viewer's device location and the venue's real coordinates, and return `null`
// whenever we can't (no viewer location, or the venue was never geocoded) so
// the UI can hide the chip / prompt for location instead of lying.
import { useMemo } from "react";
import type { Game } from "@/lib/sample-data";
import { haversineKm, useUserLocation, type LatLng } from "@/lib/geo";
import { MI_PER_KM } from "@/lib/geo";

/** True when the game carries real (non-demo) venue coordinates. */
export function hasRealGeo(game: Pick<Game, "lat" | "lng" | "pseudoGeo">): boolean {
  if (game.pseudoGeo) return false;
  const { lat, lng } = game;
  if (lat == null || lng == null) return false;
  if (Number.isNaN(lat) || Number.isNaN(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Miles between the viewer and the venue, or `null` when it can't be computed.
 * Demo games keep their canned `distanceMi` so the sample feed still reads well.
 */
export function gameDistanceMi(
  game: Pick<Game, "lat" | "lng" | "pseudoGeo" | "distanceMi">,
  viewer: LatLng | null,
): number | null {
  if (hasRealGeo(game)) {
    if (!viewer) return null;
    return haversineKm(viewer, { lat: game.lat as number, lng: game.lng as number }) / MI_PER_KM === 0
      ? 0
      : haversineKm(viewer, { lat: game.lat as number, lng: game.lng as number }) * MI_PER_KM;
  }
  // Demo/legacy rows: fall back to whatever distance was seeded.
  return game.distanceMi ?? null;
}

/** Reason the distance is unavailable — drives the "Enable location" prompt. */
export type DistanceState =
  | { mi: number; reason: null }
  | { mi: null; reason: "no-viewer-location" | "no-venue-location" };

export function gameDistanceState(
  game: Pick<Game, "lat" | "lng" | "pseudoGeo" | "distanceMi">,
  viewer: LatLng | null,
): DistanceState {
  const mi = gameDistanceMi(game, viewer);
  if (mi != null) return { mi, reason: null };
  if (!hasRealGeo(game) && game.distanceMi == null) return { mi: null, reason: "no-venue-location" };
  return { mi: null, reason: "no-viewer-location" };
}

/** Hook form: distance for one game against the viewer's current location. */
export function useGameDistance(game: Pick<Game, "lat" | "lng" | "pseudoGeo" | "distanceMi">) {
  const { coords, status, request } = useUserLocation();
  const lat = game.lat ?? null;
  const lng = game.lng ?? null;
  const pseudo = !!game.pseudoGeo;
  const seeded = game.distanceMi ?? null;
  const state = useMemo(
    () => gameDistanceState({ lat, lng, pseudoGeo: pseudo, distanceMi: seeded }, coords),
    // Primitive deps keep this stable across re-created game objects.
    [lat, lng, pseudo, seeded, coords],
  );
  return { ...state, viewer: coords, status, requestLocation: request };
}
