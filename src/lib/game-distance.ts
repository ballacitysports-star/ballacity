// Viewer-relative distance for games.
//
// The DB no longer stores a meaningful `distance_mi` — distance depends on who
// is looking. These helpers compute the great-circle distance between the
// viewer's device location and the venue's real coordinates, and return `null`
// whenever we can't (no viewer location, or the venue was never geocoded) so
// the UI can hide the chip / prompt for location instead of lying.
import { useMemo } from "react";
import type { Game } from "@/lib/sample-data";
import {
  haversineKm,
  useUserLocation,
  locationStatusExplanation,
  MI_PER_KM,
  type GeoStatus,
  type LatLng,
} from "@/lib/geo";

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
    const km = haversineKm(viewer, { lat: game.lat as number, lng: game.lng as number });
    return km * MI_PER_KM;
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
  const { coords, status, remembered, fixedAt, request, forget, error, source, label } =
    useUserLocation();
  const lat = game.lat ?? null;
  const lng = game.lng ?? null;
  const pseudo = !!game.pseudoGeo;
  const seeded = game.distanceMi ?? null;
  const state = useMemo(
    () => gameDistanceState({ lat, lng, pseudoGeo: pseudo, distanceMi: seeded }, coords),
    // Primitive deps keep this stable across re-created game objects.
    [lat, lng, pseudo, seeded, coords],
  );
  return {
    ...state,
    viewer: coords,
    status,
    remembered,
    fixedAt,
    error,
    source,
    label,
    explanation:
      state.reason == null ? null : distanceUnavailableExplanation(state.reason, status, remembered),
    requestLocation: request,
    forgetLocation: forget,
  };
}

/** Why a card shows no mileage, in plain language for tooltips/help rows. */
export function distanceUnavailableExplanation(
  reason: "no-viewer-location" | "no-venue-location",
  status: GeoStatus,
  remembered = false,
): string {
  if (reason === "no-venue-location") {
    return "The host hasn't added a mappable address for this venue, so we can't measure the distance.";
  }
  return locationStatusExplanation(status, remembered);
}
